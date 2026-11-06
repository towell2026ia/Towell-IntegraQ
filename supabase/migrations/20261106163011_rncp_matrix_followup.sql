-- IQ-RNCP-01 r2. Proposal only until specifically authorized.
-- Existing RNCP, actions, files, audit and workspace tables are reused.
alter table public.supplier_rncp_reports
  add column organization_id uuid references public.organizations(id) on delete restrict,
  add column source_kind text check(source_kind in ('native','historical','legacy')),
  add column source_sha256 text,
  add column source_row integer,
  add column historical_values jsonb,
  add column historical_supplier_name text,
  add column historical_supplier_code text,
  add column historical_status text,
  add column action_type text,
  add column notified_at timestamptz,
  add column notification_reference text,
  add column response_deadline timestamptz,
  add column first_valid_progress_at timestamptz,
  add column complete_submitted_at timestamptz,
  add column validated_at timestamptz,
  add column validated_by uuid references public.profiles(id) on delete restrict,
  add column validation_outcome text check(validation_outcome in ('pending','accepted','rejected')),
  add column validation_note text,
  add column response_requirements jsonb;
create unique index supplier_rncp_source_row_unique on public.supplier_rncp_reports(source_sha256,source_row) where source_kind='historical';
create index supplier_rncp_org_date_idx on public.supplier_rncp_reports(organization_id,report_date) where deleted_at is null;
create index supplier_rncp_notification_due_idx on public.supplier_rncp_reports(response_deadline) where source_kind='native' and deleted_at is null and closed_at is null;
alter table public.supplier_rncp_actions
  add column valid_progress_at timestamptz,
  add column root_cause text,
  add column action_plan text,
  add column containment text,
  add column commitments text,
  add column document_types jsonb;

-- An app notification requires a user ID. This narrowly scoped outbox also has
-- to represent suppliers without accounts/verified mail and durable delivery leases.
create table public.supplier_rncp_notification_outbox(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  report_id uuid not null references public.supplier_rncp_reports(id) on delete restrict,
  event_type text not null check(event_type in ('unattended','overdue','validation')),
  occurrence timestamptz not null,
  recipient_kind text not null check(recipient_kind in ('inspector','supplier')),
  recipient_id uuid references public.profiles(id) on delete restrict,
  recipient_email text,
  recipient_verified_at timestamptz,
  delivery_state text not null default 'disabled' check(delivery_state in ('disabled','pending_recipient','queued','leased','sent','failed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  next_attempt_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rncp_notification_event_unique unique(report_id,event_type,occurrence,recipient_kind),
  check(delivery_state<>'sent' or (sent_at is not null and provider_message_id is not null and recipient_verified_at is not null))
);
alter table public.supplier_rncp_notification_outbox enable row level security;
revoke all on public.supplier_rncp_notification_outbox from anon,authenticated;
grant select on public.supplier_rncp_notification_outbox to authenticated;
grant all on public.supplier_rncp_notification_outbox to service_role;

create function public.iq_rncp_actor_org(p_admin boolean default false) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
  select p.organization_id into org from public.profiles p join public.organizations o on o.id=p.organization_id
  where p.id=auth.uid() and p.status='active' and p.user_type in ('administrator','internal')
    and coalesce(p.workspace_mode,'production')='production' and o.kind='internal' and o.active
    and (not p_admin or p.user_type='administrator');
  if org is null or not public.has_module_permission('suppliers','view') or not public.has_permission('proveedores.acceder') or not public.has_permission('proveedores.ver') then
    raise exception using errcode='42501',message='RNCP_FORBIDDEN';
  end if;
  return org;
end $$;
create function public.iq_rncp_is_inspector(p_organization_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=auth.uid() and p.organization_id=p_organization_id and p.status='active'
    and coalesce(p.workspace_mode,'production')='production'
    and p.user_type in ('internal','administrator') and u.email_confirmed_at is not null
    and lower(split_part(u.email,'@',1))='inspectormp');
$$;
create function public.iq_rncp_read_scope(p_report_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.supplier_rncp_reports r join public.profiles p on p.id=auth.uid()
    where r.id=p_report_id and p.status='active' and coalesce(p.workspace_mode,'production')='production'
      and exists(select 1 from public.organizations o where o.id=r.organization_id and o.kind='internal' and o.active) and (
      (p.user_type in ('administrator','internal') and p.organization_id=r.organization_id
        and (r.deleted_at is null or p.user_type='administrator')
        and coalesce(p.workspace_mode,'production')='production' and public.has_module_permission('suppliers','view') and public.can_access_supplier_report(r.id))
      or (p.user_type='supplier' and p.external_party_id=r.supplier_id and r.portal_visible
        and (r.source_kind is distinct from 'native' or r.notified_at is not null)
        and exists(select 1 from public.organizations s where s.id=r.supplier_id and s.kind='supplier' and s.active)
        and r.deleted_at is null and public.can_access_supplier_report(r.id))));
$$;
create policy rncp_organization_read_guard on public.supplier_rncp_reports as restrictive for select to authenticated
 using(organization_id is null or public.iq_rncp_read_scope(id));
create policy rncp_action_scope_guard on public.supplier_rncp_actions as restrictive for all to authenticated
 using(exists(select 1 from public.supplier_rncp_reports r where r.id=report_id and (r.organization_id is null or public.iq_rncp_read_scope(r.id))))
 with check(exists(select 1 from public.supplier_rncp_reports r where r.id=report_id and (r.organization_id is null or public.iq_rncp_read_scope(r.id))));
create policy rncp_evidence_scope_guard on public.supplier_rncp_action_evidence as restrictive for all to authenticated
 using(exists(select 1 from public.supplier_rncp_actions a join public.supplier_rncp_reports r on r.id=a.report_id
   where a.id=action_id and (r.organization_id is null or public.iq_rncp_read_scope(r.id))))
 with check(exists(select 1 from public.supplier_rncp_actions a join public.supplier_rncp_reports r on r.id=a.report_id
   where a.id=action_id and (r.organization_id is null or public.iq_rncp_read_scope(r.id))));
create function public.iq_rncp_can_read_action_file(p_file_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.file_objects f join public.supplier_rncp_actions a on a.id=f.resource_id
   join public.supplier_rncp_reports r on r.id=a.report_id where f.id=p_file_id and f.resource_type='supplier_rncp_action_evidence'
     and r.organization_id is not null and not public.iq_rncp_read_scope(r.id));
$$;
create policy rncp_response_file_scope_guard on public.file_objects as restrictive for select to authenticated
 using(resource_type<>'supplier_rncp_action_evidence' or public.iq_rncp_can_read_action_file(id));
create function public.iq_rncp_can_read_action_object(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.file_objects f where f.bucket_id=p_bucket and f.resource_type='supplier_rncp_action_evidence'
   and (f.object_path=p_path or f.preview_path=p_path) and not public.iq_rncp_can_read_action_file(f.id));
$$;
create policy rncp_response_storage_scope_guard on storage.objects as restrictive for select to authenticated
 using(public.iq_rncp_can_read_action_object(bucket_id,name));
revoke all on function public.iq_rncp_can_read_action_file(uuid),public.iq_rncp_can_read_action_object(text,text) from public,anon;
grant execute on function public.iq_rncp_can_read_action_file(uuid),public.iq_rncp_can_read_action_object(text,text) to authenticated;
create policy rncp_outbox_read on public.supplier_rncp_notification_outbox for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'
   and p.user_type in ('administrator','internal') and p.organization_id=supplier_rncp_notification_outbox.organization_id
   and public.has_module_permission('suppliers','view')));

create function public.iq_rncp_import_history(p_rows jsonb,p_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(true); item jsonb; supplier uuid; count_rows integer; id uuid;
begin
  if p_sha256<>'92d6d355416f58042cc9ec4cce46721a94f054e48e1db390ac7920e87f30a1ca'
    or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<>226 then
    raise exception using errcode='22023',message='RNCP_SOURCE_NOT_VERIFIED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rncp-history:'||org::text,0));
  select count(*) into count_rows from public.supplier_rncp_reports where source_sha256=p_sha256 and organization_id=org;
  if count_rows=226 then return jsonb_build_object('imported',0,'alreadyImported',226); end if;
  if count_rows<>0 or (select count(distinct r->>'folio') from jsonb_array_elements(p_rows) r)<>226 then
    raise exception using errcode='23505',message='RNCP_IMPORT_CONFLICT';
  end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if item->>'folio' !~ '^RNCP[0-9]+$' or (item->>'row')::integer not between 6 and 231
      or jsonb_array_length(item->'original')<>9 or item->>'historicalStatus' not in ('Cerrado','Tarde','En Proceso')
      or nullif(trim(item->>'supplierName'),'') is null or nullif(trim(item->>'defect'),'') is null
      or exists(select 1 from public.supplier_rncp_reports where folio=item->>'folio') then
      raise exception using errcode='23505',message='RNCP_IMPORT_CONFLICT';
    end if;
    supplier:=nullif(item->>'supplierId','')::uuid;
    if supplier is not null and not exists(select 1 from public.organizations s where s.id=supplier and s.kind='supplier'
      and (s.owning_organization_id is null or s.owning_organization_id=org)) then
      raise exception using errcode='42501',message='RNCP_SUPPLIER_SCOPE_CONFLICT';
    end if;
    id:=gen_random_uuid();
    insert into public.supplier_rncp_reports(id,folio,organization_id,supplier_id,report_date,material_or_service,
      finding_type,description,status,portal_visible,created_by,updated_by,source_kind,source_sha256,source_row,
      historical_values,historical_supplier_name,historical_supplier_code,historical_status,action_type)
    values(id,item->>'folio',org,supplier,(item->>'reportDate')::date,item->>'material',item->>'defect',item->>'defect',
      case item->>'historicalStatus' when 'Cerrado' then 'closed' when 'En Proceso' then 'in_progress' else 'submitted' end,
      false,auth.uid(),auth.uid(),'historical',p_sha256,(item->>'row')::integer,item->'original',item->>'supplierName',
      item->>'supplierCode',item->>'historicalStatus',item->>'actionType');
    insert into public.audit_log(actor_id,module,action,resource_type,resource_id,entity_code_snapshot,metadata)
      values(auth.uid(),'suppliers','rncp.historical_import','supplier_rncp_report',id::text,item->>'folio',
      jsonb_build_object('source_sha256',p_sha256,'source_row',item->'row','supplier_match',item->>'reconciliationMethod','notifications_generated',false));
  end loop;
  return jsonb_build_object('imported',226,'alreadyImported',0);
end $$;

create function public.iq_rncp_missing_requirements(p_report_id uuid,p_action_id uuid) returns text[]
language plpgsql stable security definer set search_path='' as $$
declare r public.supplier_rncp_reports%rowtype; a public.supplier_rncp_actions%rowtype; missing text[]:='{}'; evidence_count integer; unique_count integer; requirement text;
begin
  if not public.iq_rncp_read_scope(p_report_id) then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  select * into r from public.supplier_rncp_reports where id=p_report_id;
  select * into a from public.supplier_rncp_actions where id=p_action_id and report_id=r.id;
  if a.id is null then return array['Análisis de causa','Plan de acciones','Observaciones y compromisos','Evidencias documentales']; end if;
  if length(trim(coalesce(a.root_cause,'')))<10 then missing:=array_append(missing,'Análisis de causa'); end if;
  if length(trim(coalesce(a.action_plan,'')))<10 then missing:=array_append(missing,'Plan de acciones'); end if;
  if coalesce((r.response_requirements->>'containment')::boolean,false) and length(trim(coalesce(a.containment,'')))<10 then missing:=array_append(missing,'Contención'); end if;
  if length(trim(coalesce(a.commitments,'')))<5 then missing:=array_append(missing,'Observaciones y compromisos'); end if;
  select count(*),count(distinct f.sha256) into evidence_count,unique_count from public.supplier_rncp_action_evidence e
    join public.file_objects f on f.id=e.file_id join storage.objects o on o.bucket_id=f.bucket_id and o.name=f.object_path
    where e.action_id=a.id and f.resource_id=a.id and f.resource_type='supplier_rncp_action_evidence'
      and f.external_organization_id=r.supplier_id and f.deleted_at is null and f.size_bytes>0 and f.sha256 ~ '^[a-f0-9]{64}$';
  if evidence_count=0 then missing:=array_append(missing,'Evidencias documentales'); end if;
  if evidence_count<>unique_count then missing:=array_append(missing,'Evidencias duplicadas'); end if;
  for requirement in select jsonb_array_elements_text(coalesce(r.response_requirements->'documents','[]')) loop
    if not exists(select 1 from public.supplier_rncp_action_evidence e join public.file_objects f on f.id=e.file_id
      where e.action_id=a.id and f.id::text=a.document_types->>requirement and f.resource_id=a.id
        and f.deleted_at is null and f.size_bytes>0 and f.sha256 ~ '^[a-f0-9]{64}$') then
      missing:=array_append(missing,'Documento obligatorio: '||requirement);
    end if;
  end loop;
  return missing;
end $$;

create function public.iq_rncp_followup_command(p_report_id uuid,p_command text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.supplier_rncp_reports%rowtype; org uuid; a public.supplier_rncp_actions%rowtype; actor public.profiles%rowtype; missing text[];
begin
  select * into actor from public.profiles where id=auth.uid() and status='active';
  select * into r from public.supplier_rncp_reports where id=p_report_id and deleted_at is null for update;
  if actor.id is null or r.id is null or r.organization_id is null or not public.iq_rncp_read_scope(r.id) then
    raise exception using errcode='42501',message='RNCP_FORBIDDEN';
  end if;
  if r.source_kind='historical' and p_command<>'reconcile' then raise exception using errcode='55000',message='RNCP_HISTORICAL_NO_TIMER'; end if;
  if p_command='record_notification' then
    org:=public.iq_rncp_actor_org();
    if not (public.is_administrator() or public.iq_rncp_is_inspector(org)) or r.organization_id<>org then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    if r.notified_at is not null then raise exception using errcode='55000',message='RNCP_NOTIFICATION_IMMUTABLE'; end if;
    if length(trim(coalesce(p_payload->>'reference','')))<8 or nullif(p_payload->>'notifiedAt','') is null
      or (p_payload->>'notifiedAt')::timestamptz>now()
      or (p_payload->>'notifiedAt')::timestamptz<(r.report_date::timestamp at time zone 'America/Mexico_City') then
      raise exception using errcode='22023',message='RNCP_NOTIFICATION_PROOF_REQUIRED';
    end if;
    update public.supplier_rncp_reports set notified_at=(p_payload->>'notifiedAt')::timestamptz,
      notification_reference=trim(p_payload->>'reference'),response_deadline=(p_payload->>'notifiedAt')::timestamptz+interval '7 days',
      response_due_date=(((p_payload->>'notifiedAt')::timestamptz+interval '7 days') at time zone 'America/Mexico_City')::date,
      status='submitted',response_requirements=jsonb_build_object('containment',coalesce((p_payload->>'containmentRequired')::boolean,false),
      'documents',coalesce(p_payload->'requiredDocuments','[]'::jsonb)),updated_by=auth.uid() where id=r.id;
  elsif p_command='submit_delivery' then
    if actor.user_type<>'supplier' or actor.external_party_id is distinct from r.supplier_id or r.notified_at is null then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    select * into a from public.supplier_rncp_actions where id=(p_payload->>'actionId')::uuid and report_id=r.id and created_by=auth.uid() for update;
    if a.status='submitted' and r.validation_outcome='pending' then return jsonb_build_object('state','validation','alreadySubmitted',true); end if;
    missing:=public.iq_rncp_missing_requirements(r.id,a.id);
    if a.id is null or cardinality(missing)>0 then raise exception using errcode='23514',message='RNCP_REQUIREMENTS_INCOMPLETE',detail=array_to_string(missing,', '); end if;
    update public.supplier_rncp_actions set status='submitted',submitted_at=now() where id=a.id;
    update public.supplier_rncp_reports set complete_submitted_at=now(),validation_outcome='pending',status='in_progress',updated_by=auth.uid() where id=r.id;
  elsif p_command in ('approve','reject') then
    if not public.iq_rncp_is_inspector(r.organization_id) or r.complete_submitted_at is null or r.validation_outcome is distinct from 'pending' then
      raise exception using errcode='42501',message='RNCP_INSPECTOR_VALIDATION_REQUIRED';
    end if;
    if nullif(trim(p_payload->>'reason'),'') is null then raise exception using errcode='22023',message='RNCP_REASON_REQUIRED'; end if;
    select * into a from public.supplier_rncp_actions where report_id=r.id and status='submitted' order by submitted_at desc limit 1 for update;
    if p_command='approve' and (a.id is null or cardinality(public.iq_rncp_missing_requirements(r.id,a.id))>0) then raise exception using errcode='23514',message='RNCP_REQUIREMENTS_INCOMPLETE'; end if;
    update public.supplier_rncp_actions set status=case when p_command='approve' then 'accepted'::public.supplier_response_status else 'rejected'::public.supplier_response_status end,
      validated_at=now(),validated_by=auth.uid(),validation_comment=trim(p_payload->>'reason') where id=a.id;
    update public.supplier_rncp_reports set validation_outcome=case when p_command='approve' then 'accepted' else 'rejected' end,
      validated_at=now(),validated_by=auth.uid(),validation_note=trim(p_payload->>'reason'),
      closed_at=case when p_command='approve' then now() else null end,status=case when p_command='approve' then 'closed' else 'in_progress' end,updated_by=auth.uid() where id=r.id;
  elsif p_command='reconcile' then
    org:=public.iq_rncp_actor_org(true);
    if org<>r.organization_id or r.supplier_id is not null or nullif(trim(p_payload->>'reason'),'') is null then raise exception using errcode='42501',message='RNCP_RECONCILIATION_REQUIRED'; end if;
    if not exists(select 1 from public.organizations s where s.id=(p_payload->>'supplierId')::uuid and s.kind='supplier'
      and (s.owning_organization_id is null or s.owning_organization_id=org)) then raise exception using errcode='42501',message='RNCP_SUPPLIER_SCOPE_CONFLICT'; end if;
    update public.supplier_rncp_reports set supplier_id=(p_payload->>'supplierId')::uuid,updated_by=auth.uid() where id=r.id;
  else raise exception using errcode='22023',message='RNCP_COMMAND_INVALID';
  end if;
  insert into public.audit_log(actor_id,module,action,resource_type,resource_id,entity_code_snapshot,reason,metadata)
    values(auth.uid(),'suppliers','rncp.'||p_command,'supplier_rncp_report',r.id::text,r.folio,p_payload->>'reason',
      jsonb_build_object('previous_deadline',r.response_deadline,'notification_reference',p_payload->>'reference','command',p_command));
  return jsonb_build_object('id',r.id,'folio',r.folio);
end $$;

-- Area-specific AND guards preserve every unrelated workspace permission.
create policy rncp_workspace_read_guard on public.workspace_data as restrictive for select to authenticated
 using(area not in ('rncpFollowupSettings','rncpAlertReviews') or exists(select 1 from public.profiles p
   where p.id=auth.uid() and p.status='active' and p.user_type in ('administrator','internal')
     and p.organization_id=workspace_data.workspace_id and public.has_module_permission('suppliers','view')));
create policy rncp_workspace_insert_guard on public.workspace_data as restrictive for insert to authenticated
 with check(area not in ('rncpFollowupSettings','rncpAlertReviews'));
create policy rncp_workspace_update_guard on public.workspace_data as restrictive for update to authenticated
 using(area not in ('rncpFollowupSettings','rncpAlertReviews')) with check(area not in ('rncpFollowupSettings','rncpAlertReviews'));
create policy rncp_workspace_delete_guard on public.workspace_data as restrictive for delete to authenticated
 using(area not in ('rncpFollowupSettings','rncpAlertReviews'));
create function public.iq_rncp_save_workspace(p_area text,p_payload jsonb,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(true); row public.workspace_data%rowtype; previous_payload jsonb;
begin
  if p_area not in ('rncpFollowupSettings','rncpAlertReviews') or jsonb_typeof(p_payload)<>'object' then raise exception 'RNCP_SETTINGS_INVALID'; end if;
  -- Real outbound activation is a separate, explicitly authorized phase.
  if p_area='rncpFollowupSettings' and coalesce((p_payload->>'emailEnabled')::boolean,false) then raise exception 'RNCP_REAL_EMAIL_NOT_AUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||':'||p_area,0));
  select * into row from public.workspace_data where workspace_id=org and workspace_mode='production' and area=p_area and deleted_at is null for update;
  if p_expected_revision is null or coalesce(row.revision,0)<>p_expected_revision then raise exception using errcode='40001',message='RNCP_SETTINGS_CHANGED'; end if;
  previous_payload:=row.payload;
  if row.id is null then
    insert into public.workspace_data(workspace_id,workspace_mode,area,payload,created_by,updated_by)
      values(org,'production',p_area,p_payload,auth.uid(),auth.uid()) returning * into row;
  else update public.workspace_data set payload=p_payload,revision=revision+1,updated_by=auth.uid() where id=row.id returning * into row;
  end if;
  insert into public.audit_log(actor_id,module,action,resource_type,resource_id,metadata)
    values(auth.uid(),'suppliers','rncp.settings_reviewed','workspace_data',row.id::text,jsonb_build_object('area',p_area,'revision',row.revision,'previous',previous_payload,'current',p_payload));
  return jsonb_build_object('revision',row.revision);
end $$;

-- New original PDFs are private server resources. Legacy files keep their policies.
create policy rncp_original_file_guard on public.file_objects as restrictive for all to authenticated
 using(resource_type not in ('supplier_rncp_original','supplier_rncp_import_pending'))
 with check(resource_type not in ('supplier_rncp_original','supplier_rncp_import_pending'));
create policy rncp_original_storage_guard on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'integraq-private' or name not like 'rncp-originals/%')
 with check(bucket_id<>'integraq-private' or name not like 'rncp-originals/%');
create unique index rncp_original_sha_unique on public.file_objects(workspace_id,sha256)
 where resource_type in ('supplier_rncp_original','supplier_rncp_import_pending') and deleted_at is null;
create unique index rncp_response_action_sha_unique on public.file_objects(resource_id,sha256)
 where resource_type='supplier_rncp_action_evidence' and deleted_at is null and sha256 is not null;

revoke all on function public.iq_rncp_actor_org(boolean),public.iq_rncp_is_inspector(uuid),public.iq_rncp_read_scope(uuid),
 public.iq_rncp_import_history(jsonb,text),public.iq_rncp_missing_requirements(uuid,uuid),public.iq_rncp_followup_command(uuid,text,jsonb),public.iq_rncp_save_workspace(text,jsonb,integer) from public,anon;
grant execute on function public.iq_rncp_actor_org(boolean),public.iq_rncp_is_inspector(uuid),public.iq_rncp_read_scope(uuid),
 public.iq_rncp_import_history(jsonb,text),public.iq_rncp_missing_requirements(uuid,uuid),public.iq_rncp_followup_command(uuid,text,jsonb),public.iq_rncp_save_workspace(text,jsonb,integer) to authenticated;
-- A managed report cannot be closed through legacy RPCs or direct requests.
create function public.iq_rncp_guard_report() returns trigger
language plpgsql set search_path='' as $$
declare actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active';
  if tg_op='INSERT' and new.source_kind is null then
    if actor.user_type not in ('administrator','internal') or not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    new.organization_id:=actor.organization_id; new.source_kind:='native'; new.response_due_date:=null;
  end if;
  if new.source_kind is null then return new; end if;
  if actor.id is null or coalesce(actor.workspace_mode,'production')<>'production' then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  if not exists(select 1 from public.organizations where id=new.organization_id and kind='internal' and active) then raise exception 'RNCP_ORGANIZATION_INVALID'; end if;
  if new.supplier_id is not null and not exists(select 1 from public.organizations s where s.id=new.supplier_id and s.kind='supplier'
    and (s.owning_organization_id is null or s.owning_organization_id=new.organization_id)) then raise exception 'RNCP_SUPPLIER_SCOPE_CONFLICT'; end if;
  if tg_op='UPDATE' and (new.organization_id,new.source_kind,new.source_sha256,new.source_row,new.historical_values,
    new.historical_supplier_name,new.historical_supplier_code,new.historical_status)
    is distinct from (old.organization_id,old.source_kind,old.source_sha256,old.source_row,old.historical_values,
    old.historical_supplier_name,old.historical_supplier_code,old.historical_status) then
    raise exception using errcode='42501',message='RNCP_SOURCE_IMMUTABLE';
  end if;
  if new.source_kind='historical' then
    if actor.user_type<>'administrator' or actor.organization_id<>new.organization_id then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    if new.notified_at is not null or new.response_deadline is not null or new.first_valid_progress_at is not null
      or new.complete_submitted_at is not null then raise exception 'RNCP_HISTORICAL_NO_TIMER'; end if;
    if tg_op='UPDATE' and (new.folio,new.report_date,new.material_or_service,new.description,new.status,new.closed_at)
      is distinct from (old.folio,old.report_date,old.material_or_service,old.description,old.status,old.closed_at) then raise exception 'RNCP_SOURCE_IMMUTABLE'; end if;
    return new;
  end if;
  if actor.user_type in ('administrator','internal') then
    if actor.organization_id is distinct from new.organization_id or not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  elsif actor.user_type='supplier' then
    if tg_op='UPDATE' and old.closed_at is not null then raise exception 'RNCP_RESPONSE_LOCKED'; end if;
    if actor.external_party_id is distinct from new.supplier_id or not public.can_access_supplier_report(new.id) then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    if tg_op='UPDATE' and (to_jsonb(new)-array['first_valid_progress_at','status','complete_submitted_at','validation_outcome','updated_at','updated_by'])
      is distinct from (to_jsonb(old)-array['first_valid_progress_at','status','complete_submitted_at','validation_outcome','updated_at','updated_by']) then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  else raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  if new.notified_at is null then new.response_deadline:=null; new.response_due_date:=null;
  else
    if nullif(trim(new.notification_reference),'') is null or new.notified_at>now() then raise exception 'RNCP_NOTIFICATION_PROOF_REQUIRED'; end if;
    if tg_op='UPDATE' and old.notified_at is not null and (new.notified_at,new.response_deadline) is distinct from (old.notified_at,old.response_deadline) then raise exception 'RNCP_NOTIFICATION_IMMUTABLE'; end if;
    new.response_deadline:=new.notified_at+interval '7 days';
    new.response_due_date:=(new.response_deadline at time zone 'America/Mexico_City')::date;
  end if;
  if new.status='closed' and (tg_op='INSERT' or old.status is distinct from 'closed' or (new.closed_at,new.validated_at,new.validated_by,new.validation_outcome) is distinct from (old.closed_at,old.validated_at,old.validated_by,old.validation_outcome))
    and (new.validation_outcome is distinct from 'accepted' or new.validated_at is null
    or new.closed_at is null or not public.iq_rncp_is_inspector(new.organization_id)) then raise exception using errcode='42501',message='RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
  if new.first_valid_progress_at is not null and (tg_op='INSERT' or new.first_valid_progress_at is distinct from old.first_valid_progress_at) and not exists(select 1 from public.supplier_rncp_actions a
    join public.profiles p on p.id=a.created_by where a.report_id=new.id and length(trim(a.description))>=10
    and p.user_type='supplier' and p.external_party_id=new.supplier_id) then raise exception 'RNCP_VALID_PROGRESS_REQUIRED'; end if;
  if new.first_valid_progress_at is not null and (tg_op='INSERT' or new.first_valid_progress_at is distinct from old.first_valid_progress_at)
    and new.first_valid_progress_at is distinct from (select min(a.valid_progress_at) from public.supplier_rncp_actions a join public.profiles p on p.id=a.created_by
      where a.report_id=new.id and a.valid_progress_at>=new.notified_at and length(trim(a.description))>=10 and p.user_type='supplier' and p.external_party_id=new.supplier_id) then raise exception 'RNCP_PROGRESS_TIMESTAMP_INVALID'; end if;
  if new.complete_submitted_at is not null and (tg_op='INSERT' or new.complete_submitted_at is distinct from old.complete_submitted_at)
    and not exists(select 1 from public.supplier_rncp_actions a where a.report_id=new.id and a.status in ('submitted','accepted')
      and a.submitted_at=new.complete_submitted_at and cardinality(public.iq_rncp_missing_requirements(new.id,a.id))=0) then raise exception 'RNCP_REQUIREMENTS_INCOMPLETE'; end if;
  if new.validation_outcome in ('accepted','rejected') and (tg_op='INSERT' or new.validation_outcome is distinct from old.validation_outcome)
    and not public.iq_rncp_is_inspector(new.organization_id) then raise exception 'RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
  return new;
end $$;
create trigger iq_rncp_report_guard before insert or update on public.supplier_rncp_reports
 for each row execute function public.iq_rncp_guard_report();

create function public.iq_rncp_guard_action() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.supplier_rncp_reports%rowtype; actor public.profiles%rowtype;
begin
  select * into r from public.supplier_rncp_reports where id=new.report_id for update;
  if r.source_kind is null then return new; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active';
  if actor.id is null or coalesce(actor.workspace_mode,'production')<>'production' or r.source_kind='historical' or r.deleted_at is not null or r.closed_at is not null then raise exception using errcode='42501',message='RNCP_RESPONSE_LOCKED'; end if;
  if r.notified_at is null then raise exception 'RNCP_NOTIFICATION_REQUIRED'; end if;
  new.created_at:=case when tg_op='INSERT' then now() else old.created_at end;
  new.updated_at:=now();
  new.valid_progress_at:=case when tg_op='UPDATE' then old.valid_progress_at else null end;
  if tg_op='UPDATE' and (new.report_id,new.created_by) is distinct from (old.report_id,old.created_by) then raise exception 'RNCP_RESPONSE_IDENTITY_IMMUTABLE'; end if;
  if new.status in ('accepted','rejected') then
    if not public.iq_rncp_is_inspector(r.organization_id) then raise exception using errcode='42501',message='RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
    if new.validated_by is distinct from auth.uid() or new.validated_at is null then raise exception 'RNCP_VALIDATION_AUDIT_REQUIRED'; end if;
    if tg_op='INSERT' or (to_jsonb(new)-array['status','validated_by','validated_at','validation_comment','updated_at'])
      is distinct from (to_jsonb(old)-array['status','validated_by','validated_at','validation_comment','updated_at']) then raise exception 'RNCP_RESPONSE_IDENTITY_IMMUTABLE'; end if;
    if new.status='accepted' and cardinality(public.iq_rncp_missing_requirements(r.id,new.id))>0 then raise exception 'RNCP_REQUIREMENTS_INCOMPLETE'; end if;
  else
    if actor.user_type<>'supplier' or actor.external_party_id is distinct from r.supplier_id or new.created_by is distinct from auth.uid()
      or not public.iq_rncp_read_scope(r.id) then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    if tg_op='UPDATE' and old.status='submitted' then raise exception 'RNCP_RESPONSE_LOCKED'; end if;
    if tg_op='UPDATE' and (new.report_id,new.created_by) is distinct from (old.report_id,old.created_by) then raise exception 'RNCP_RESPONSE_IDENTITY_IMMUTABLE'; end if;
    if length(trim(new.description))<10 then raise exception 'RNCP_VALID_PROGRESS_REQUIRED'; end if;
    if new.valid_progress_at is null and (length(trim(coalesce(new.root_cause,'')))>=10
      or length(trim(coalesce(new.action_plan,'')))>=10 or length(trim(coalesce(new.containment,'')))>=10
      or exists(select 1 from public.supplier_rncp_action_evidence e join public.file_objects f on f.id=e.file_id
        join storage.objects o on o.bucket_id=f.bucket_id and o.name=f.object_path
        where e.action_id=new.id and f.resource_id=new.id and f.external_organization_id=r.supplier_id
          and f.resource_type='supplier_rncp_action_evidence' and f.deleted_at is null and f.size_bytes>0 and f.sha256 ~ '^[a-f0-9]{64}$')) then
      new.valid_progress_at:=now();
    end if;
    if new.status='submitted' and (tg_op='INSERT' or old.status is distinct from 'submitted') then
      -- A saved partial advance is not a complete delivery. The explicit command
      -- checks structured fields and linked, private originals after persistence.
      if tg_op='INSERT' or cardinality(public.iq_rncp_missing_requirements(r.id,new.id))>0 then
        new.status:='in_progress'; new.submitted_at:=null;
      else new.submitted_at:=now(); end if;
    end if;
  end if;
  return new;
end $$;
create trigger iq_rncp_action_guard before insert or update on public.supplier_rncp_actions
 for each row execute function public.iq_rncp_guard_action();
create function public.iq_rncp_capture_progress() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.supplier_rncp_reports where id=new.report_id and source_kind='native' and notified_at is not null)
    and exists(select 1 from public.profiles p where p.id=new.created_by and p.user_type='supplier')
    and new.valid_progress_at is not null then
    update public.supplier_rncp_reports set first_valid_progress_at=coalesce(first_valid_progress_at,(select min(a.valid_progress_at) from public.supplier_rncp_actions a join public.profiles p on p.id=a.created_by
      where a.report_id=new.report_id and a.valid_progress_at>=(select notified_at from public.supplier_rncp_reports where id=new.report_id)
      and length(trim(a.description))>=10 and p.user_type='supplier' and p.external_party_id=(select supplier_id from public.supplier_rncp_reports where id=new.report_id))),
      status=case when status='closed' then status else 'in_progress' end,
      complete_submitted_at=case when new.status='submitted' then new.submitted_at else complete_submitted_at end,
      validation_outcome=case when new.status='submitted' then 'pending' else validation_outcome end,updated_by=auth.uid()
      where id=new.report_id and closed_at is null;
  end if;
  return new;
end $$;
create trigger iq_rncp_progress_recorded after insert or update on public.supplier_rncp_actions
 for each row execute function public.iq_rncp_capture_progress();

revoke all on function public.iq_rncp_guard_report(),public.iq_rncp_guard_action(),public.iq_rncp_capture_progress() from public,anon,authenticated;
-- Preserve the legacy API signature, removing only the obsolete manually supplied response deadline.
CREATE OR REPLACE FUNCTION public.save_supplier_rncp(requested_report_id uuid, requested_action text, requested_payload jsonb DEFAULT '{}'::jsonb, requested_reason text DEFAULT NULL::text)
 RETURNS supplier_rncp_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      then
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
$function$;
revoke all on function public.save_supplier_rncp(uuid,text,jsonb,text) from public,anon;
grant execute on function public.save_supplier_rncp(uuid,text,jsonb,text) to authenticated;
create function public.iq_rncp_save_response(p_action_id uuid,p_report_id uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.supplier_rncp_reports%rowtype; actor public.profiles%rowtype; action_id uuid:=coalesce(p_action_id,gen_random_uuid()); previous_response jsonb;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active' and user_type='supplier';
  select * into r from public.supplier_rncp_reports where id=p_report_id and source_kind='native' and deleted_at is null for update;
  if actor.id is null or r.id is null or actor.external_party_id is distinct from r.supplier_id
    or not public.iq_rncp_read_scope(r.id) or r.closed_at is not null then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  if r.notified_at is null then raise exception 'RNCP_NOTIFICATION_REQUIRED'; end if;
  if length(trim(coalesce(p_payload->>'description','')))<10 or nullif(trim(p_payload->>'responsibleName'),'') is null
    or nullif(p_payload->>'dueDate','') is null then raise exception 'RNCP_VALID_PROGRESS_REQUIRED'; end if;
  if p_action_id is null then
    insert into public.supplier_rncp_actions(id,report_id,description,responsible_name,due_date,status,created_by,
      root_cause,action_plan,containment,commitments,document_types)
      values(action_id,r.id,trim(p_payload->>'description'),trim(p_payload->>'responsibleName'),(p_payload->>'dueDate')::date,
        'in_progress',auth.uid(),p_payload->>'rootCause',p_payload->>'actionPlan',p_payload->>'containment',p_payload->>'commitments',coalesce(p_payload->'documentTypes','{}'));
  else
    if not exists(select 1 from public.supplier_rncp_actions where id=action_id and report_id=r.id and created_by=auth.uid() and status not in ('accepted','closed','submitted')) then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    select to_jsonb(a) into previous_response from public.supplier_rncp_actions a where a.id=action_id;
    update public.supplier_rncp_actions set description=trim(p_payload->>'description'),responsible_name=trim(p_payload->>'responsibleName'),
      due_date=(p_payload->>'dueDate')::date,root_cause=p_payload->>'rootCause',action_plan=p_payload->>'actionPlan',
      containment=p_payload->>'containment',commitments=p_payload->>'commitments',document_types=coalesce(p_payload->'documentTypes','{}'),status='in_progress'
      where id=action_id;
  end if;
  insert into public.audit_log(actor_id,module,action,resource_type,resource_id,entity_code_snapshot,metadata)
    values(auth.uid(),'suppliers','rncp.response_saved','supplier_rncp_report',r.id::text,r.folio,jsonb_build_object('action_id',action_id,'previous',previous_response,'current',p_payload));
  return action_id;
end $$;

create function public.iq_rncp_queue_notifications(p_organization_id uuid,p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.supplier_rncp_reports%rowtype; event text; occurrence timestamptz; recipient text;
declare target uuid; address text; confirmed timestamptz; candidates integer; inserted integer; total integer:=0;
begin
  if p_now is null or abs(extract(epoch from (p_now-now())))>300 then raise exception 'RNCP_CLOCK_INVALID'; end if;
  for r in select * from public.supplier_rncp_reports where organization_id=p_organization_id and source_kind='native'
    and notified_at is not null and closed_at is null and deleted_at is null loop
    foreach event in array array['unattended','overdue','validation'] loop
      occurrence:=null;
      if event='unattended' and r.first_valid_progress_at is null and p_now>r.notified_at+interval '24 hours' then occurrence:=r.notified_at; end if;
      if event='overdue' and p_now>=r.response_deadline and (r.complete_submitted_at is null or r.complete_submitted_at>r.response_deadline or r.validation_outcome='rejected') then occurrence:=r.response_deadline; end if;
      if event='validation' and r.validation_outcome='pending' and r.complete_submitted_at is not null then occurrence:=r.complete_submitted_at; end if;
      if occurrence is null then continue; end if;
      foreach recipient in array case when event='validation' then array['inspector'] else array['inspector','supplier'] end loop
        target:=null; address:=null; confirmed:=null;
        select count(*) into candidates from public.profiles p join auth.users u on u.id=p.id where p.status='active' and u.email_confirmed_at is not null
          and ((recipient='inspector' and p.organization_id=r.organization_id and p.user_type in ('administrator','internal') and lower(split_part(u.email,'@',1))='inspectormp')
            or (recipient='supplier' and p.user_type='supplier' and p.external_party_id=r.supplier_id));
        if candidates=1 then
          select p.id,u.email,u.email_confirmed_at into target,address,confirmed from public.profiles p join auth.users u on u.id=p.id where p.status='active' and u.email_confirmed_at is not null
          and ((recipient='inspector' and p.organization_id=r.organization_id and p.user_type in ('administrator','internal') and lower(split_part(u.email,'@',1))='inspectormp')
            or (recipient='supplier' and p.user_type='supplier' and p.external_party_id=r.supplier_id));
        end if;
        insert into public.supplier_rncp_notification_outbox(organization_id,report_id,event_type,occurrence,recipient_kind,
          recipient_id,recipient_email,recipient_verified_at,delivery_state,last_error_code)
          values(r.organization_id,r.id,event,occurrence,recipient,target,address,confirmed,
            case when confirmed is null then 'pending_recipient' else 'disabled' end,
            case when confirmed is null then 'VERIFIED_RECIPIENT_REQUIRED' else 'REAL_EMAIL_DISABLED' end)
          on conflict on constraint rncp_notification_event_unique do nothing;
        get diagnostics inserted=row_count; total:=total+inserted;
      end loop;
    end loop;
  end loop;
  return total;
end $$;
create function public.iq_rncp_claim_notification(p_id uuid) returns public.supplier_rncp_notification_outbox
language plpgsql security definer set search_path='' as $$
declare selected public.supplier_rncp_notification_outbox%rowtype;
begin
  select * into selected from public.supplier_rncp_notification_outbox where id=p_id for update skip locked;
  if selected.id is null or selected.recipient_verified_at is null or selected.recipient_email is null or selected.attempts>=5
    or selected.delivery_state not in ('queued','failed','leased') or selected.next_attempt_at>now()
    or (selected.delivery_state='leased' and selected.lease_until>now()) then return null; end if;
  if not exists(select 1 from public.supplier_rncp_reports where id=selected.report_id and source_kind='native' and deleted_at is null and closed_at is null) then return null; end if;
  update public.supplier_rncp_notification_outbox set delivery_state='leased',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
    where id=selected.id returning * into selected;
  return selected;
end $$;
create function public.iq_rncp_finish_notification(p_id uuid,p_lease uuid,p_message_id text,p_error_code text default null) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_error_code is not null and p_error_code not in ('AUTHENTICATION','CONNECTION','PROVIDER_FAILURE','CONFIGURATION','RECIPIENT_INVALID') then raise exception 'RNCP_ERROR_CODE_INVALID'; end if;
  update public.supplier_rncp_notification_outbox set
    delivery_state=case when p_error_code is null and nullif(trim(p_message_id),'') is not null then 'sent' else 'failed' end,
    provider_message_id=case when p_error_code is null then p_message_id end,
    sent_at=case when p_error_code is null and nullif(trim(p_message_id),'') is not null then now() end,
    last_error_code=p_error_code,next_attempt_at=now()+least(power(2,attempts),24)*interval '1 hour',lease_until=null,updated_at=now()
    where id=p_id and lease_id=p_lease and delivery_state='leased' and lease_until>now();
  return found;
end $$;
revoke all on function public.iq_rncp_save_response(uuid,uuid,jsonb) from public,anon;
grant execute on function public.iq_rncp_save_response(uuid,uuid,jsonb) to authenticated;
revoke all on function public.iq_rncp_queue_notifications(uuid,timestamptz),public.iq_rncp_claim_notification(uuid),public.iq_rncp_finish_notification(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.iq_rncp_queue_notifications(uuid,timestamptz),public.iq_rncp_claim_notification(uuid),public.iq_rncp_finish_notification(uuid,uuid,text,text) to service_role;
create function public.iq_rncp_canonical_supplier_code(p_code text) returns text
language sql immutable set search_path='' as $$
  select case when upper(trim(p_code)) ~ '^(PR)?[0-9]+$' then
    coalesce(nullif(ltrim(regexp_replace(upper(trim(p_code)),'^PR',''),'0'),''),'0') else upper(trim(p_code)) end;
$$;
create function public.iq_rncp_register_original(p_file jsonb,p_report_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(true); r public.supplier_rncp_reports%rowtype;
duplicate uuid; file_version integer; file_id uuid:=(p_file->>'id')::uuid; kind text:='supplier_rncp_import_pending';
begin
  if p_file->>'sha256' !~ '^[a-f0-9]{64}$' or (p_file->>'sizeBytes')::bigint not between 8 and 4194304
    or p_file->>'mimeType'<>'application/pdf' or split_part(p_file->>'path','/',1)<>'rncp-originals'
    or split_part(p_file->>'path','/',2)<>org::text or split_part(p_file->>'path','/',3)<>auth.uid()::text
    or not exists(select 1 from storage.objects where bucket_id='integraq-private' and name=p_file->>'path') then
    raise exception using errcode='42501',message='RNCP_ORIGINAL_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text||':'||(p_file->>'sha256'),0));
  select id into duplicate from public.file_objects where workspace_id=org and sha256=p_file->>'sha256'
    and resource_type in ('supplier_rncp_original','supplier_rncp_import_pending') and deleted_at is null;
  if duplicate is not null then return jsonb_build_object('state','duplicate','fileId',duplicate); end if;
  if p_report_id is not null then
    select * into r from public.supplier_rncp_reports where id=p_report_id and organization_id=org and deleted_at is null for update;
    if r.id is null or r.supplier_id is null or r.folio is distinct from p_file->'identity'->>'folio'
      or not exists(select 1 from public.organizations s where s.id=r.supplier_id and s.kind='supplier'
        and (public.iq_rncp_canonical_supplier_code(s.code)=public.iq_rncp_canonical_supplier_code(p_file->'identity'->>'supplierCode')
          or public.iq_rncp_canonical_supplier_code(r.historical_supplier_code)=public.iq_rncp_canonical_supplier_code(p_file->'identity'->>'supplierCode'))) then
      raise exception using errcode='42501',message='RNCP_PDF_IDENTITY_MISMATCH';
    end if;
    kind:='supplier_rncp_original';
    select coalesce(max(f.version),0)+1 into file_version from public.file_objects f where f.resource_type=kind and f.resource_id=r.id;
    update public.file_objects set is_current=false where resource_type=kind and resource_id=r.id and is_current;
  else file_version:=1;
  end if;
  insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,audience,
    resource_type,resource_id,resource_key,workspace_id,version,is_current,uploaded_by,preview_status,observations,external_organization_id)
    values(file_id,'integraq-private',p_file->>'path',p_file->>'name','application/pdf',(p_file->>'sizeBytes')::bigint,p_file->>'sha256',
    'suppliers','internal',kind,r.id,p_file->'identity'->>'folio',org,file_version,true,auth.uid(),'not_required',(p_file->'identity')::text,r.supplier_id);
  insert into public.audit_log(actor_id,module,action,resource_type,resource_id,entity_code_snapshot,metadata)
    values(auth.uid(),'suppliers',case when r.id is null then 'rncp.pdf_pending' else 'rncp.pdf_linked' end,
      case when r.id is null then 'file_object' else 'supplier_rncp_report' end,coalesce(r.id,file_id)::text,r.folio,
      jsonb_build_object('file_id',file_id,'sha256',p_file->>'sha256','version',file_version,'report_created',false));
  return jsonb_build_object('state',case when r.id is null then 'pending' else 'linked' end,'fileId',file_id,'reportId',r.id,'version',file_version);
end $$;
create function public.iq_rncp_reconcile_original(p_file_id uuid,p_report_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(true); f public.file_objects%rowtype; r public.supplier_rncp_reports%rowtype; identity jsonb; next_version integer;
begin
  select * into r from public.supplier_rncp_reports where id=p_report_id and organization_id=org and deleted_at is null for update;
  select * into f from public.file_objects where id=p_file_id and workspace_id=org and resource_type='supplier_rncp_import_pending' and deleted_at is null for update;
  identity:=f.observations::jsonb;
  if f.id is null or r.id is null or r.supplier_id is null or identity->>'folio' is distinct from r.folio
    or not exists(select 1 from public.organizations s where s.id=r.supplier_id
      and (public.iq_rncp_canonical_supplier_code(s.code)=public.iq_rncp_canonical_supplier_code(identity->>'supplierCode')
      or public.iq_rncp_canonical_supplier_code(r.historical_supplier_code)=public.iq_rncp_canonical_supplier_code(identity->>'supplierCode'))) then
    raise exception using errcode='42501',message='RNCP_PDF_IDENTITY_MISMATCH';
  end if;
  select coalesce(max(version),0)+1 into next_version from public.file_objects where resource_type='supplier_rncp_original' and resource_id=r.id;
  update public.file_objects set is_current=false where resource_type='supplier_rncp_original' and resource_id=r.id and is_current;
  update public.file_objects set resource_type='supplier_rncp_original',resource_id=r.id,version=next_version,
    external_organization_id=r.supplier_id,is_current=true where id=f.id;
  insert into public.audit_log(actor_id,module,action,resource_type,resource_id,entity_code_snapshot,metadata)
    values(auth.uid(),'suppliers','rncp.pdf_reconciled','supplier_rncp_report',r.id::text,r.folio,jsonb_build_object('file_id',f.id,'report_created',false));
  return true;
end $$;
create function public.iq_rncp_requirements_summary(p_report_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare id uuid; action uuid; result jsonb:='{}';
begin
  if cardinality(p_report_ids)>500 then raise exception 'RNCP_BATCH_TOO_LARGE'; end if;
  foreach id in array p_report_ids loop
    if not public.iq_rncp_read_scope(id) then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
    select a.id into action from public.supplier_rncp_actions a where a.report_id=id
      order by (a.status in ('submitted','accepted')) desc,a.updated_at desc limit 1;
    result:=result||jsonb_build_object(id::text,to_jsonb(public.iq_rncp_missing_requirements(id,action)));
  end loop;
  return result;
end $$;
revoke all on function public.iq_rncp_register_original(jsonb,uuid),public.iq_rncp_reconcile_original(uuid,uuid),public.iq_rncp_requirements_summary(uuid[]) from public,anon;
grant execute on function public.iq_rncp_register_original(jsonb,uuid),public.iq_rncp_reconcile_original(uuid,uuid),public.iq_rncp_requirements_summary(uuid[]) to authenticated;
-- Preserve managed RNCP and linked evidence: operational retirement is logical.
create policy rncp_report_no_physical_delete on public.supplier_rncp_reports as restrictive for delete to authenticated
 using(source_kind is null);
create policy rncp_action_no_physical_delete on public.supplier_rncp_actions as restrictive for delete to authenticated
 using(not exists(select 1 from public.supplier_rncp_reports r where r.id=report_id and r.source_kind is not null));
create policy rncp_evidence_no_physical_delete on public.supplier_rncp_action_evidence as restrictive for delete to authenticated
 using(not exists(select 1 from public.supplier_rncp_actions a join public.supplier_rncp_reports r on r.id=a.report_id where a.id=action_id and r.source_kind is not null));
create policy rncp_response_file_no_physical_delete on public.file_objects as restrictive for delete to authenticated
 using(resource_type<>'supplier_rncp_action_evidence');

create function public.iq_rncp_response_file_writable(p_resource uuid,p_external uuid,p_uploader uuid,p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.supplier_rncp_actions a join public.supplier_rncp_reports r on r.id=a.report_id
   join public.profiles p on p.id=auth.uid() where a.id=p_resource and a.created_by=p.id and p.status='active' and p.user_type='supplier'
   and p.external_party_id=r.supplier_id and p_external=r.supplier_id and p_uploader=p.id
   and r.deleted_at is null and r.closed_at is null and a.status in ('pending','in_progress','rejected')
   and p_bucket='integraq-private' and split_part(p_path,'/',1)=p.id::text and split_part(p_path,'/',2)='rncp'
   and public.iq_rncp_read_scope(r.id));
$$;
revoke all on function public.iq_rncp_response_file_writable(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.iq_rncp_response_file_writable(uuid,uuid,uuid,text,text) to authenticated;
create policy rncp_response_file_insert_guard on public.file_objects as restrictive for insert to authenticated
 with check(resource_type<>'supplier_rncp_action_evidence' or public.iq_rncp_response_file_writable(resource_id,external_organization_id,uploaded_by,bucket_id,object_path));
-- File replacement creates a new private file/link; an old reference is never repointed.
create policy rncp_response_file_update_guard on public.file_objects as restrictive for update to authenticated
 using(resource_type<>'supplier_rncp_action_evidence') with check(resource_type<>'supplier_rncp_action_evidence');
create function public.iq_rncp_response_link_writable(p_action uuid,p_file uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_actor=auth.uid() and exists(select 1 from public.file_objects f where f.id=p_file and f.resource_type='supplier_rncp_action_evidence'
   and f.resource_id=p_action and f.deleted_at is null and f.size_bytes>0
   and public.iq_rncp_response_file_writable(f.resource_id,f.external_organization_id,f.uploaded_by,f.bucket_id,f.object_path));
$$;
revoke all on function public.iq_rncp_response_link_writable(uuid,uuid,uuid) from public,anon;
grant execute on function public.iq_rncp_response_link_writable(uuid,uuid,uuid) to authenticated;
create policy rncp_response_link_insert_guard on public.supplier_rncp_action_evidence as restrictive for insert to authenticated
 with check(public.iq_rncp_response_link_writable(action_id,file_id,created_by));
create policy rncp_response_link_update_guard on public.supplier_rncp_action_evidence as restrictive for update to authenticated
 using(false) with check(false);
create function public.iq_rncp_refresh_response_progress(p_action_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.supplier_rncp_reports%rowtype; a public.supplier_rncp_actions%rowtype;
begin
  select r0.* into r from public.supplier_rncp_reports r0 join public.supplier_rncp_actions a0 on a0.report_id=r0.id where a0.id=p_action_id for update of r0;
  select * into a from public.supplier_rncp_actions where id=p_action_id for update;
  if a.id is null or a.created_by is distinct from auth.uid() or not public.iq_rncp_read_scope(r.id)
    or r.source_kind is distinct from 'native' then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
  update public.supplier_rncp_actions set updated_at=now() where id=a.id;
  return true;
end $$;
revoke all on function public.iq_rncp_refresh_response_progress(uuid) from public,anon;
grant execute on function public.iq_rncp_refresh_response_progress(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.notify_supplier_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  report_folio text;
begin
  -- Managed RNCP use the scoped, disabled-by-default queue; never the legacy global dispatcher.
  if exists(select 1 from public.supplier_rncp_reports r where r.id=new.report_id and r.source_kind is not null) then return new; end if;
  if new.status <> 'submitted' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select folio into report_folio
  from public.supplier_rncp_reports where id = new.report_id;

  insert into public.notifications (
    recipient_id, title, message, module_id, resource_type, resource_id, action_url
  )
  select distinct p.id,
    'Respuesta de proveedor recibida',
    'El proveedor actualizó acciones o evidencias del RNCP ' || report_folio || '.',
    'suppliers', 'supplier_rncp_report', new.report_id,
    '/#suppliers'
  from public.profiles p
  join public.user_module_permissions m on m.user_id = p.id
  where p.status = 'active' and m.module_id = 'suppliers' and m.can_view;

  insert into public.integration_outbox (
    event_type, resource_type, resource_id, payload
  ) values (
    'supplier_response_submitted', 'supplier_rncp_report', new.report_id,
    jsonb_build_object('folio', report_folio, 'action_id', new.id)
  );
  return new;
end;
$function$;
revoke all on function public.notify_supplier_response() from public,anon,authenticated;

notify pgrst,'reload schema';
