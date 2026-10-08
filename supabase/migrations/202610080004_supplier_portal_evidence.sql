-- IQ-PRD-PROV-03: acciones y evidencias privadas en el Portal de Proveedores.

begin;

create table public.file_upload_policies (
  resource_type text primary key,
  max_size_bytes bigint not null check (max_size_bytes > 0),
  allowed_mime_types text[] not null,
  updated_at timestamptz not null default now()
);
insert into public.file_upload_policies(resource_type, max_size_bytes, allowed_mime_types)
values (
  'supplier_rncp_action_evidence',
  15728640,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (resource_type) do update set
  max_size_bytes = excluded.max_size_bytes,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

alter table public.file_upload_policies enable row level security;
create policy file_upload_policies_read on public.file_upload_policies
for select to authenticated using (true);
create policy file_upload_policies_admin_write on public.file_upload_policies
for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
grant select, insert, update on public.file_upload_policies to authenticated;

alter table public.supplier_rncp_actions
  add column responsible_name text,
  add column executed_at date;

alter table public.file_objects
  add column external_site_id uuid references public.external_company_sites(id) on delete restrict;
create index file_objects_external_site_idx on public.file_objects(external_site_id);
create trigger file_objects_validate_external_site
before insert or update of external_organization_id, external_site_id on public.file_objects
for each row execute function public.validate_external_company_site();

create table public.supplier_rncp_action_evidence (
  action_id uuid not null references public.supplier_rncp_actions(id) on delete cascade,
  file_id uuid not null references public.file_objects(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (action_id, file_id)
);
create index supplier_rncp_action_evidence_file_idx on public.supplier_rncp_action_evidence(file_id);

create or replace function public.can_access_supplier_action(requested_action_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.supplier_rncp_actions action
    where action.id = requested_action_id
      and public.can_access_supplier_report(action.report_id)
  );
$$;

create or replace function public.can_upload_supplier_rncp_evidence(requested_action_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.supplier_rncp_actions action
    join public.supplier_rncp_reports report on report.id = action.report_id
    where action.id = requested_action_id
      and action.created_by = auth.uid()
      and action.status in ('pending', 'in_progress', 'submitted')
      and report.status in ('submitted', 'in_progress')
      and report.deleted_at is null
      and public.current_user_type() = 'supplier'
      and public.can_access_supplier_report(report.id)
  );
$$;

alter table public.supplier_rncp_action_evidence enable row level security;
create policy supplier_rncp_action_evidence_select on public.supplier_rncp_action_evidence
for select to authenticated using (public.can_access_supplier_action(action_id));
create policy supplier_rncp_action_evidence_insert on public.supplier_rncp_action_evidence
for insert to authenticated with check (
  created_by = auth.uid()
  and public.can_upload_supplier_rncp_evidence(action_id)
  and exists (
    select 1 from public.file_objects file
    where file.id = file_id and file.uploaded_by = auth.uid()
      and file.resource_type = 'supplier_rncp_action_evidence'
      and file.resource_id = action_id
  )
);
grant select, insert on public.supplier_rncp_action_evidence to authenticated;

create or replace function public.save_supplier_rncp_action(
  requested_action_id uuid,
  requested_report_id uuid,
  requested_description text,
  requested_responsible_name text,
  requested_due_date date,
  requested_executed_at date,
  requested_comment text,
  requested_status public.supplier_response_status
)
returns public.supplier_rncp_actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  saved_action public.supplier_rncp_actions%rowtype;
  selected_action public.supplier_rncp_actions%rowtype;
begin
  if public.current_user_type() <> 'supplier'
    or not public.can_access_supplier_report(requested_report_id) then
    raise exception using errcode = '42501', message = 'RNCP_ACTION_FORBIDDEN';
  end if;
  if nullif(trim(requested_description), '') is null
    or nullif(trim(requested_responsible_name), '') is null
    or requested_due_date is null then
    raise exception using errcode = '23514', message = 'RNCP_ACTION_REQUIRED_FIELDS';
  end if;
  if requested_status not in ('pending', 'in_progress', 'submitted') then
    raise exception using errcode = '23514', message = 'RNCP_ACTION_STATUS_INVALID';
  end if;
  if requested_action_id is null then
    insert into public.supplier_rncp_actions(
      report_id, description, responsible_name, due_date, executed_at,
      supplier_comment, status, submitted_at, created_by
    ) values (
      requested_report_id, trim(requested_description), trim(requested_responsible_name),
      requested_due_date, requested_executed_at, nullif(trim(requested_comment), ''),
      requested_status, case when requested_status = 'submitted' then now() else null end, actor_id
    ) returning * into saved_action;
  else
    select * into selected_action from public.supplier_rncp_actions
    where id = requested_action_id and report_id = requested_report_id for update;
    if selected_action.id is null or selected_action.created_by <> actor_id
      or selected_action.status in ('accepted', 'rejected', 'closed') then
      raise exception using errcode = '42501', message = 'RNCP_ACTION_EDIT_FORBIDDEN';
    end if;
    update public.supplier_rncp_actions set
      description = trim(requested_description),
      responsible_name = trim(requested_responsible_name),
      due_date = requested_due_date,
      executed_at = requested_executed_at,
      supplier_comment = nullif(trim(requested_comment), ''),
      status = requested_status,
      submitted_at = case when requested_status = 'submitted' then coalesce(submitted_at, now()) else submitted_at end
    where id = requested_action_id returning * into saved_action;
  end if;
  return saved_action;
end;
$$;

create or replace function public.review_supplier_rncp_action(
  requested_action_id uuid,
  requested_decision text,
  requested_comment text
)
returns public.supplier_rncp_actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  saved_action public.supplier_rncp_actions%rowtype;
  selected_action public.supplier_rncp_actions%rowtype;
  report_folio text;
begin
  if not public.is_internal_user() or not public.has_module_permission('suppliers', 'update') then
    raise exception using errcode = '42501', message = 'RNCP_REVIEW_FORBIDDEN';
  end if;
  if requested_decision not in ('accepted', 'rejected') then
    raise exception using errcode = '23514', message = 'RNCP_REVIEW_INVALID';
  end if;
  if requested_decision = 'rejected' and nullif(trim(requested_comment), '') is null then
    raise exception using errcode = '23514', message = 'RNCP_REJECTION_COMMENT_REQUIRED';
  end if;
  select action.* into selected_action
  from public.supplier_rncp_actions action
  join public.supplier_rncp_reports report on report.id = action.report_id
  where action.id = requested_action_id and report.deleted_at is null for update of action;
  if selected_action.id is null or selected_action.status <> 'submitted'
    or not public.can_access_supplier_report(selected_action.report_id) then
    raise exception using errcode = '22023', message = 'RNCP_REVIEW_NOT_AVAILABLE';
  end if;
  select folio into report_folio from public.supplier_rncp_reports where id = selected_action.report_id;
  update public.supplier_rncp_actions set
    status = requested_decision::public.supplier_response_status,
    validated_by = actor_id,
    validated_at = now(),
    validation_comment = nullif(trim(requested_comment), '')
  where id = requested_action_id returning * into saved_action;

  insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, reason, metadata)
  values (
    actor_id, 'suppliers', case when requested_decision = 'accepted' then 'rncp.action_validated' else 'rncp.action_rejected' end,
    'supplier_rncp_report', saved_action.report_id::text, report_folio,
    jsonb_build_object('action_id', saved_action.id, 'status', saved_action.status),
    nullif(trim(requested_comment), ''), jsonb_build_object('action_id', saved_action.id)
  );
  return saved_action;
end;
$$;

create or replace function public.audit_supplier_rncp_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_report public.supplier_rncp_reports%rowtype;
  selected_file public.file_objects%rowtype;
begin
  select report.* into selected_report
  from public.supplier_rncp_reports report
  join public.supplier_rncp_actions action on action.report_id = report.id
  where action.id = new.action_id;
  select * into selected_file from public.file_objects where id = new.file_id;
  insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, metadata)
  values (
    new.created_by, 'suppliers', 'rncp.evidence_added', 'supplier_rncp_report', selected_report.id::text,
    selected_report.folio, jsonb_build_object('action_id', new.action_id, 'file_id', new.file_id, 'file_name', selected_file.original_name),
    jsonb_build_object('supplier_id', selected_report.supplier_id, 'site_id', selected_report.site_id)
  );
  return new;
end;
$$;
create trigger supplier_rncp_evidence_audit
after insert on public.supplier_rncp_action_evidence
for each row execute function public.audit_supplier_rncp_evidence();

drop policy if exists file_objects_select_scope on public.file_objects;
create policy file_objects_select_scope on public.file_objects
for select to authenticated using (
  (
    resource_type = 'general_information_document'
    and public.can_access_general_information_workspace(workspace_id)
    and (deleted_at is null or public.is_administrator())
  )
  or (
    resource_type = 'supplier_rncp_action_evidence'
    and deleted_at is null
    and public.can_access_supplier_action(resource_id)
  )
  or (
    resource_type not in ('general_information_document', 'supplier_rncp_action_evidence')
    and (
      public.is_administrator()
      or (
        deleted_at is null and (
          uploaded_by = auth.uid()
          or (
            public.is_internal_user() and (
              (process_id is not null and public.has_process_access(process_id))
              or (module_id is not null and public.has_module_permission(module_id, 'view'))
            )
          )
          or (
            external_organization_id in (select public.current_organization_ids())
            and (
              audience = 'shared'
              or (audience = 'customer' and public.current_user_type() = 'customer')
              or (audience = 'supplier' and public.current_user_type() = 'supplier')
            )
          )
        )
      )
    )
  )
);

drop policy if exists file_objects_insert_admin on public.file_objects;
drop policy if exists file_objects_insert_scope on public.file_objects;
create policy file_objects_insert_scope on public.file_objects
for insert to authenticated with check (
  uploaded_by = auth.uid()
  and (
    (
      resource_type = 'general_information_document'
      and public.is_administrator()
      and public.can_access_general_information_workspace(workspace_id)
    )
    or (
      resource_type = 'supplier_rncp_action_evidence'
      and module_id = 'suppliers'
      and audience = 'supplier'
      and resource_id is not null
      and public.can_upload_supplier_rncp_evidence(resource_id)
      and exists (
        select 1 from public.file_upload_policies policy
        where policy.resource_type = 'supplier_rncp_action_evidence'
          and size_bytes between 1 and policy.max_size_bytes
          and mime_type = any(policy.allowed_mime_types)
      )
      and exists (
        select 1
        from public.supplier_rncp_actions action
        join public.supplier_rncp_reports report on report.id = action.report_id
        where action.id = resource_id
          and external_organization_id = report.supplier_id
          and external_site_id is not distinct from report.site_id
      )
    )
    or (
      resource_type not in ('general_information_document', 'supplier_rncp_action_evidence')
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and case
            when resource_type = 'indicator_result' then
              module_id = 'indicators' and process_id is not null
              and public.can_capture_indicator_evidence(resource_key, process_id)
            else
              (process_id is not null and public.has_process_access(process_id))
              or (module_id is not null and public.has_module_permission(module_id, 'create'))
          end
        )
        or external_organization_id in (select public.current_organization_ids())
      )
    )
  )
);

drop policy if exists file_objects_update_owner on public.file_objects;
create policy file_objects_update_owner on public.file_objects
for update to authenticated using (
  public.is_administrator()
  or (
    resource_type not in ('general_information_document', 'supplier_rncp_action_evidence')
    and uploaded_by = auth.uid()
  )
)
with check (
  public.is_administrator()
  or (
    resource_type not in ('general_information_document', 'supplier_rncp_action_evidence')
    and uploaded_by = auth.uid()
  )
);

create policy integraq_storage_insert_rncp_evidence
on storage.objects for insert to authenticated with check (
  bucket_id = 'integraq-private'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (storage.foldername(name))[2] = 'rncp'
  and public.can_upload_supplier_rncp_evidence(((storage.foldername(name))[3])::uuid)
);

grant execute on function public.can_access_supplier_action(uuid) to authenticated;
grant execute on function public.can_upload_supplier_rncp_evidence(uuid) to authenticated;
grant execute on function public.save_supplier_rncp_action(uuid, uuid, text, text, date, date, text, public.supplier_response_status) to authenticated;
grant execute on function public.review_supplier_rncp_action(uuid, text, text) to authenticated;

comment on table public.supplier_rncp_action_evidence is
  'Relación de múltiples evidencias privadas por acción RNCP; el acceso hereda empresa y sucursal del reporte.';
comment on table public.file_upload_policies is
  'Configuración central de tamaño y MIME permitidos por tipo de carga.';

commit;
