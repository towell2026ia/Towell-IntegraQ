-- IQ-PRD-PROV-02: ciclo de vida persistente y auditable de RNCP.

begin;

drop view if exists public.supplier_quality_summary;

alter table public.supplier_rncp_reports alter column status drop default;
alter table public.supplier_rncp_reports
  alter column status type text
  using case status::text
    when 'open' then 'submitted'
    when 'late' then 'in_progress'
    else status::text
  end;
alter table public.supplier_rncp_reports alter column status set default 'draft';
alter table public.supplier_rncp_reports
  add constraint supplier_rncp_reports_lifecycle_status_check
  check (status in ('draft', 'submitted', 'in_progress', 'closed'));

alter table public.supplier_rncp_reports
  alter column supplier_id drop not null,
  alter column report_date drop not null,
  alter column description drop not null,
  alter column response_due_date drop not null,
  add column responsible_name text,
  add column submitted_at timestamptz,
  add column updated_by uuid references public.profiles(id) on delete set null,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id) on delete restrict,
  add column delete_reason text,
  add constraint supplier_rncp_reports_soft_delete_check check (
    (deleted_at is null and deleted_by is null and delete_reason is null)
    or (deleted_at is not null and deleted_by is not null and nullif(trim(delete_reason), '') is not null)
  );

create index supplier_rncp_active_history_idx
  on public.supplier_rncp_reports(report_date desc, created_at desc)
  where deleted_at is null;
create index supplier_rncp_deleted_idx
  on public.supplier_rncp_reports(deleted_at desc)
  where deleted_at is not null;

create or replace function public.can_access_supplier_report(requested_report_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.supplier_rncp_reports report
    where report.id = requested_report_id
      and (
        public.is_administrator()
        or (
          report.deleted_at is null
          and public.is_internal_user()
          and public.has_module_permission('suppliers', 'view')
          and public.has_permission('proveedores.acceder')
          and public.has_permission('proveedores.ver')
        )
        or (
          report.deleted_at is null
          and report.status in ('submitted', 'in_progress', 'closed')
          and report.portal_visible
          and public.has_external_organization_scope('supplier', report.supplier_id)
          and public.has_external_site_scope(report.site_id)
          and public.has_permission('portal_proveedores.acceder', null, null, null, null, false, report.supplier_id)
        )
      )
  );
$$;

drop policy if exists supplier_rncp_internal_write on public.supplier_rncp_reports;
revoke insert, update, delete on public.supplier_rncp_reports from authenticated;

drop policy if exists supplier_actions_external_insert on public.supplier_rncp_actions;
drop policy if exists supplier_actions_external_update on public.supplier_rncp_actions;
create policy supplier_actions_external_insert on public.supplier_rncp_actions
for insert to authenticated with check (
  created_by = auth.uid()
  and public.can_access_supplier_report(report_id)
  and exists (
    select 1 from public.supplier_rncp_reports report
    where report.id = report_id and report.status in ('submitted', 'in_progress') and report.deleted_at is null
  )
);
create policy supplier_actions_external_update on public.supplier_rncp_actions
for update to authenticated using (
  created_by = auth.uid() and public.can_access_supplier_report(report_id)
)
with check (
  created_by = auth.uid()
  and public.can_access_supplier_report(report_id)
  and exists (
    select 1 from public.supplier_rncp_reports report
    where report.id = report_id and report.status in ('submitted', 'in_progress') and report.deleted_at is null
  )
);

create or replace function public.guard_supplier_action_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_status text;
  report_deleted_at timestamptz;
begin
  select status, deleted_at into report_status, report_deleted_at
  from public.supplier_rncp_reports where id = new.report_id;
  if report_status is null or report_deleted_at is not null or report_status = 'closed' then
    raise exception using errcode = '22023', message = 'RNCP_ACTIONS_LOCKED';
  end if;
  if public.current_user_type() = 'supplier' then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    else
      if new.report_id <> old.report_id
        or new.due_date <> old.due_date
        or new.validated_by is distinct from old.validated_by
        or new.validated_at is distinct from old.validated_at
        or new.validation_comment is distinct from old.validation_comment then
        raise exception using errcode = '42501', message = 'RNCP_ACTION_CONTROL_FORBIDDEN';
      end if;
      new.created_by := old.created_by;
    end if;
    if new.status not in ('pending', 'in_progress', 'submitted') then
      raise exception using errcode = '42501', message = 'RNCP_ACTION_STATUS_FORBIDDEN';
    end if;
    if new.status = 'submitted' and new.submitted_at is null then new.submitted_at := now(); end if;
  end if;
  return new;
end;
$$;

create or replace function public.save_supplier_rncp(
  requested_report_id uuid,
  requested_action text,
  requested_payload jsonb default '{}'::jsonb,
  requested_reason text default null
)
returns public.supplier_rncp_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_type public.app_user_type;
  current_report public.supplier_rncp_reports%rowtype;
  saved_report public.supplier_rncp_reports%rowtype;
  report_id uuid := coalesce(requested_report_id, gen_random_uuid());
  report_folio text;
  supplier_id uuid := nullif(requested_payload->>'supplierId', '')::uuid;
  site_id uuid := nullif(requested_payload->>'siteId', '')::uuid;
  report_date date := nullif(requested_payload->>'reportDate', '')::date;
  finding_type text := nullif(trim(requested_payload->>'findingType'), '');
  material_or_service text := nullif(trim(requested_payload->>'materialOrService'), '');
  description text := nullif(trim(requested_payload->>'description'), '');
  responsible_name text := nullif(trim(requested_payload->>'responsibleName'), '');
  response_due_date date := nullif(requested_payload->>'responseDueDate', '')::date;
  reason text := nullif(trim(coalesce(requested_reason, '')), '');
  next_status text;
  audit_action text;
begin
  select user_type into actor_type from public.profiles where id = actor_id and status = 'active';
  if actor_id is null or actor_type not in ('administrator', 'internal')
    or not public.has_module_permission('suppliers', 'update') then
    raise exception using errcode = '42501', message = 'RNCP_WRITE_FORBIDDEN';
  end if;
  if requested_action not in ('draft', 'submit', 'progress', 'close', 'reopen', 'correct') then
    raise exception using errcode = '22023', message = 'RNCP_ACTION_INVALID';
  end if;

  if requested_report_id is not null then
    select * into current_report from public.supplier_rncp_reports where id = requested_report_id for update;
    if current_report.id is null then
      raise exception using errcode = '22023', message = 'RNCP_NOT_FOUND';
    end if;
    if current_report.deleted_at is not null then
      raise exception using errcode = '22023', message = 'RNCP_DELETED';
    end if;
  end if;

  if requested_action in ('submit', 'correct') then
    if supplier_id is null or report_date is null or finding_type is null
      or material_or_service is null or description is null or responsible_name is null
      or response_due_date is null then
      raise exception using errcode = '23514', message = 'RNCP_REQUIRED_FIELDS_MISSING';
    end if;
    if exists (
      select 1 from public.external_company_sites site
      where site.company_id = supplier_id and site.active
    ) and site_id is null then
      raise exception using errcode = '23514', message = 'RNCP_SITE_REQUIRED';
    end if;
  end if;
  if supplier_id is not null and not exists (
    select 1 from public.organizations organization
    where organization.id = supplier_id and organization.kind = 'supplier' and organization.active
  ) then
    raise exception using errcode = '23514', message = 'RNCP_SUPPLIER_INVALID';
  end if;
  if site_id is not null and not exists (
    select 1 from public.external_company_sites site
    where site.id = site_id and site.company_id = supplier_id and site.active
  ) then
    raise exception using errcode = '23514', message = 'RNCP_SITE_INVALID';
  end if;

  if current_report.id is null then
    if requested_action not in ('draft', 'submit') then
      raise exception using errcode = '22023', message = 'RNCP_CREATE_ACTION_INVALID';
    end if;
    next_status := case when requested_action = 'submit' then 'submitted' else 'draft' end;
    report_folio := 'RNCP-' || to_char(current_date, 'YYYY') || '-' || upper(substr(replace(report_id::text, '-', ''), 1, 8));
    insert into public.supplier_rncp_reports(
      id, folio, supplier_id, site_id, report_date, purchase_order,
      material_or_service, finding_type, rejected_quantity, description,
      immediate_disposition, response_due_date, responsible_name, status,
      submitted_at, portal_visible, created_by, updated_by
    ) values (
      report_id, report_folio, supplier_id, site_id, report_date,
      nullif(trim(requested_payload->>'purchaseOrder'), ''), material_or_service,
      finding_type, nullif(requested_payload->>'rejectedQuantity', '')::numeric,
      description, nullif(trim(requested_payload->>'immediateDisposition'), ''),
      response_due_date, responsible_name, next_status,
      case when next_status = 'submitted' then now() else null end,
      coalesce((requested_payload->>'portalVisible')::boolean, true), actor_id, actor_id
    ) returning * into saved_report;
    insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, metadata)
    values (actor_id, 'suppliers', 'rncp.created', 'supplier_rncp_report', report_id::text, report_folio,
      jsonb_build_object('status', next_status), jsonb_build_object('supplier_id', supplier_id, 'site_id', site_id));
    audit_action := case when next_status = 'submitted' then 'rncp.submitted' else 'rncp.draft_saved' end;
  else
    report_folio := current_report.folio;
    if requested_action = 'draft' then
      if current_report.status <> 'draft' then raise exception using errcode = '22023', message = 'RNCP_DRAFT_LOCKED'; end if;
      next_status := 'draft'; audit_action := 'rncp.draft_saved';
    elsif requested_action = 'submit' then
      if current_report.status <> 'draft' then raise exception using errcode = '22023', message = 'RNCP_ALREADY_SUBMITTED'; end if;
      next_status := 'submitted'; audit_action := 'rncp.submitted';
    elsif requested_action = 'progress' then
      if current_report.status not in ('submitted', 'in_progress') then raise exception using errcode = '22023', message = 'RNCP_TRANSITION_INVALID'; end if;
      supplier_id := current_report.supplier_id; site_id := current_report.site_id;
      report_date := current_report.report_date; finding_type := current_report.finding_type;
      material_or_service := current_report.material_or_service; description := current_report.description;
      responsible_name := coalesce(responsible_name, current_report.responsible_name);
      response_due_date := coalesce(response_due_date, current_report.response_due_date);
      next_status := 'in_progress'; audit_action := 'rncp.assigned';
    elsif requested_action = 'close' then
      if current_report.status not in ('submitted', 'in_progress') then raise exception using errcode = '22023', message = 'RNCP_TRANSITION_INVALID'; end if;
      supplier_id := current_report.supplier_id; site_id := current_report.site_id;
      report_date := current_report.report_date; finding_type := current_report.finding_type;
      material_or_service := current_report.material_or_service; description := current_report.description;
      responsible_name := current_report.responsible_name; response_due_date := current_report.response_due_date;
      next_status := 'closed'; audit_action := 'rncp.closed';
    elsif requested_action = 'reopen' then
      if actor_type <> 'administrator' or reason is null then raise exception using errcode = '42501', message = 'RNCP_ADMIN_REASON_REQUIRED'; end if;
      if current_report.status <> 'closed' then raise exception using errcode = '22023', message = 'RNCP_TRANSITION_INVALID'; end if;
      supplier_id := current_report.supplier_id; site_id := current_report.site_id;
      report_date := current_report.report_date; finding_type := current_report.finding_type;
      material_or_service := current_report.material_or_service; description := current_report.description;
      responsible_name := current_report.responsible_name; response_due_date := current_report.response_due_date;
      next_status := 'in_progress'; audit_action := 'rncp.reopened';
    else
      if actor_type <> 'administrator' or reason is null then raise exception using errcode = '42501', message = 'RNCP_ADMIN_REASON_REQUIRED'; end if;
      next_status := current_report.status; audit_action := 'rncp.corrected';
    end if;

    update public.supplier_rncp_reports set
      supplier_id = save_supplier_rncp.supplier_id,
      site_id = save_supplier_rncp.site_id,
      report_date = save_supplier_rncp.report_date,
      purchase_order = case when requested_action in ('draft', 'submit', 'correct') then nullif(trim(requested_payload->>'purchaseOrder'), '') else purchase_order end,
      material_or_service = save_supplier_rncp.material_or_service,
      finding_type = save_supplier_rncp.finding_type,
      rejected_quantity = case when requested_action in ('draft', 'submit', 'correct') then nullif(requested_payload->>'rejectedQuantity', '')::numeric else rejected_quantity end,
      description = save_supplier_rncp.description,
      immediate_disposition = case when requested_action in ('draft', 'submit', 'progress', 'correct') then coalesce(nullif(trim(requested_payload->>'immediateDisposition'), ''), immediate_disposition) else immediate_disposition end,
      response_due_date = save_supplier_rncp.response_due_date,
      responsible_name = save_supplier_rncp.responsible_name,
      status = next_status,
      submitted_at = case when requested_action = 'submit' then now() else submitted_at end,
      closed_at = case when requested_action = 'close' then now() when requested_action = 'reopen' then null else closed_at end,
      updated_by = actor_id
    where id = current_report.id
    returning * into saved_report;
  end if;

  insert into public.audit_log(
    actor_id, module, action, resource_type, resource_id, entity_code_snapshot,
    previous_value, new_value, reason, metadata
  ) values (
    actor_id, 'suppliers', audit_action, 'supplier_rncp_report', saved_report.id::text,
    saved_report.folio,
    case when current_report.id is null then null else jsonb_build_object('status', current_report.status) end,
    jsonb_build_object('status', saved_report.status, 'response_due_date', saved_report.response_due_date),
    reason, jsonb_build_object('supplier_id', saved_report.supplier_id, 'site_id', saved_report.site_id)
  );
  return saved_report;
end;
$$;

create or replace function public.set_supplier_rncp_deleted(
  requested_report_id uuid,
  requested_deleted boolean,
  requested_reason text
)
returns public.supplier_rncp_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  reason text := nullif(trim(coalesce(requested_reason, '')), '');
  current_report public.supplier_rncp_reports%rowtype;
  saved_report public.supplier_rncp_reports%rowtype;
begin
  if not public.is_administrator() then
    raise exception using errcode = '42501', message = 'RNCP_DELETE_ADMIN_ONLY';
  end if;
  if reason is null then
    raise exception using errcode = '23514', message = 'RNCP_DELETE_REASON_REQUIRED';
  end if;
  select * into current_report from public.supplier_rncp_reports where id = requested_report_id for update;
  if current_report.id is null then raise exception using errcode = '22023', message = 'RNCP_NOT_FOUND'; end if;
  if requested_deleted = (current_report.deleted_at is not null) then return current_report; end if;

  update public.supplier_rncp_reports set
    deleted_at = case when requested_deleted then now() else null end,
    deleted_by = case when requested_deleted then actor_id else null end,
    delete_reason = case when requested_deleted then reason else null end,
    updated_by = actor_id
  where id = requested_report_id returning * into saved_report;

  insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, previous_value, new_value, reason, metadata)
  values (
    actor_id, 'suppliers', case when requested_deleted then 'rncp.deleted' else 'rncp.restored' end,
    'supplier_rncp_report', saved_report.id::text, saved_report.folio,
    jsonb_build_object('deleted_at', current_report.deleted_at),
    jsonb_build_object('deleted_at', saved_report.deleted_at), reason,
    jsonb_build_object('supplier_id', saved_report.supplier_id, 'site_id', saved_report.site_id)
  );
  return saved_report;
end;
$$;

create or replace function public.audit_supplier_rncp_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_report public.supplier_rncp_reports%rowtype;
begin
  select * into selected_report from public.supplier_rncp_reports where id = new.report_id;
  if tg_op = 'INSERT' then
    insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, metadata)
    values (coalesce(auth.uid(), new.created_by), 'suppliers', 'rncp.action_added', 'supplier_rncp_report', new.report_id::text,
      selected_report.folio, jsonb_build_object('action_id', new.id, 'description', new.description),
      jsonb_build_object('supplier_id', selected_report.supplier_id, 'site_id', selected_report.site_id));
  end if;
  if new.evidence_file_id is not null and (tg_op = 'INSERT' or old.evidence_file_id is null) then
    insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, metadata)
    values (coalesce(auth.uid(), new.created_by), 'suppliers', 'rncp.evidence_added', 'supplier_rncp_report', new.report_id::text,
      selected_report.folio, jsonb_build_object('action_id', new.id, 'evidence_file_id', new.evidence_file_id),
      jsonb_build_object('supplier_id', selected_report.supplier_id, 'site_id', selected_report.site_id));
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_rncp_action_audit on public.supplier_rncp_actions;
create trigger supplier_rncp_action_audit
after insert or update of evidence_file_id on public.supplier_rncp_actions
for each row execute function public.audit_supplier_rncp_action();

create view public.supplier_quality_summary
with (security_invoker = true)
as
select
  organization.id,
  organization.code,
  organization.name,
  profile.category,
  profile.audit_required,
  profile.effectiveness,
  profile.current_quality_level,
  (select count(*) from public.supplier_rncp_reports report
    where report.supplier_id = organization.id and report.deleted_at is null) as rncp_total,
  (select count(*) from public.supplier_rncp_reports report
    where report.supplier_id = organization.id and report.deleted_at is null and report.status = 'closed') as rncp_closed,
  (select count(*) from public.supplier_rncp_reports report
    where report.supplier_id = organization.id and report.deleted_at is null
      and report.status in ('submitted', 'in_progress') and report.response_due_date < current_date) as rncp_late,
  (select count(*) from public.supplier_rncp_reports report
    where report.supplier_id = organization.id and report.deleted_at is null
      and report.status in ('submitted', 'in_progress')) as rncp_open,
  (select min(audit.scheduled_date) from public.audits audit
    where audit.external_organization_id = organization.id and audit.audit_type = 'supplier'
      and audit.status = 'scheduled' and audit.scheduled_date >= current_date) as next_audit
from public.organizations organization
left join public.supplier_quality_profiles profile on profile.organization_id = organization.id
where organization.kind = 'supplier' and organization.active;

grant select on public.supplier_quality_summary to authenticated;
grant execute on function public.save_supplier_rncp(uuid, text, jsonb, text) to authenticated;
grant execute on function public.set_supplier_rncp_deleted(uuid, boolean, text) to authenticated;

comment on column public.supplier_rncp_reports.status is
  'Estado base: draft, submitted, in_progress o closed. Tardía se deriva por fecha compromiso.';
comment on column public.supplier_rncp_reports.deleted_at is
  'Soft delete administrativo; el registro y su historial permanecen íntegros.';

commit;
