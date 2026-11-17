-- PROPOSAL ONLY. Not executed. Apply only after review in an isolated cloud Preview.
-- Depends on RNCP matrix migration, private original guards, photo V2 and existing permissions.
-- No records renumbered, no backfill, no mail, no historical document writes during installation.
begin;
-- Fail before any DDL if the reviewed dependencies or private storage guard are absent.
do $$
begin
 if to_regprocedure('public.iq_rncp_actor_org(boolean)') is null
   or to_regprocedure('public.iq_rncp_initial_photo_manifest(uuid)') is null
   or to_regprocedure('public.iq_rncp_is_inspector(uuid)') is null
   or to_regprocedure('public.save_supplier_rncp(uuid,text,jsonb,text)') is null
   then raise exception 'RNCP_FLOW_DEPENDENCIES_MISSING'; end if;
 if not exists(select 1 from storage.buckets where id='integraq-private' and not public) then raise exception 'RNCP_PRIVATE_BUCKET_REQUIRED'; end if;
 if not exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polname='rncp_original_storage_guard'
   and not polpermissive and polcmd='*' and pg_get_expr(polqual,polrelid) like '%rncp-originals/%'
   and pg_get_expr(polwithcheck,polrelid) like '%rncp-originals/%') then raise exception 'RNCP_ORIGINAL_STORAGE_GUARD_REQUIRED'; end if;
 if not has_table_privilege('service_role','public.file_objects','SELECT') then raise exception 'RNCP_FILE_METADATA_SELECT_REQUIRED'; end if;
end $$;
alter table public.supplier_rncp_reports add column classification text
  constraint supplier_rncp_classification_check check (classification in ('QAC','Hilo','Avíos'));
CREATE OR REPLACE FUNCTION public.save_supplier_rncp(requested_report_id uuid, requested_action text, requested_payload jsonb DEFAULT '{}'::jsonb, requested_reason text DEFAULT NULL::text)
 RETURNS supplier_rncp_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  actor_org uuid := public.iq_rncp_actor_org(false);
  selected_classification text := nullif(requested_payload->>'classification','');
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
  if requested_action='close' then raise exception 'RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
  if requested_action not in ('draft', 'submit', 'progress', 'close', 'reopen', 'correct') then
    raise exception using errcode = '22023', message = 'RNCP_ACTION_INVALID';
  end if;

  if requested_report_id is not null then
    select * into current_report from public.supplier_rncp_reports where id = requested_report_id and organization_id = actor_org for update;
    if current_report.id is null then
      raise exception using errcode = '22023', message = 'RNCP_NOT_FOUND';
    end if;
    if current_report.deleted_at is not null then
      raise exception using errcode = '22023', message = 'RNCP_DELETED';
    end if;
  end if;

  if requested_action in ('draft','submit','correct') then
    if current_report.source_kind='historical' and selected_classification is distinct from current_report.classification then raise exception 'RNCP_HISTORICAL_IMMUTABLE'; end if;
    if current_report.id is null or current_report.source_kind='native' then
      if selected_classification is null or selected_classification not in ('QAC','Hilo','Avíos') then raise exception 'RNCP_CLASSIFICATION_REQUIRED'; end if;
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
    report_folio := 'ASSIGNED_BY_TRIGGER';
    insert into public.supplier_rncp_reports(
      id, folio, classification, supplier_id, site_id, report_date, purchase_order,
      material_or_service, finding_type, rejected_quantity, description,
      immediate_disposition, response_due_date, responsible_name, status,
      submitted_at, portal_visible, created_by, updated_by
    ) values (
      report_id, report_folio, selected_classification, supplier_id, site_id, report_date,
      null, material_or_service,
      finding_type, nullif(requested_payload->>'rejectedQuantity', '')::numeric,
      description, nullif(trim(requested_payload->>'immediateDisposition'), ''),
      response_due_date, responsible_name, next_status,
      case when next_status = 'submitted' then now() else null end,
      coalesce((requested_payload->>'portalVisible')::boolean, true), actor_id, actor_id
    ) returning * into saved_report;
    report_folio := saved_report.folio;
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

    perform set_config('integraq.rncp.change_reason',coalesce(reason,''),true);
    update public.supplier_rncp_reports set
      supplier_id = save_supplier_rncp.supplier_id,
      site_id = save_supplier_rncp.site_id,
      report_date = save_supplier_rncp.report_date,
      purchase_order = current_report.purchase_order,
      classification = case when requested_action in ('draft','submit','correct') then selected_classification else current_report.classification end,
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
    case when current_report.id is null then null else to_jsonb(current_report) end,
    to_jsonb(saved_report),
    reason, jsonb_build_object('supplier_id', saved_report.supplier_id, 'site_id', saved_report.site_id)
  );
  return saved_report;
end;
$function$;
revoke all on function public.save_supplier_rncp(uuid,text,jsonb,text) from public,anon;
grant execute on function public.save_supplier_rncp(uuid,text,jsonb,text) to authenticated;

create function public.iq_rncp_flow_contract() returns integer language plpgsql stable security definer set search_path='' as $$
begin perform public.iq_rncp_actor_org(false); return 1; end $$;
revoke all on function public.iq_rncp_flow_contract() from public,anon;
grant execute on function public.iq_rncp_flow_contract() to authenticated;

-- Snapshot is derived from stored data only. It serializes behind authorized report writes.
create function public.iq_rncp_pdf_snapshot(p_report uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(false); r public.supplier_rncp_reports%rowtype; payload jsonb;
begin
 if not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org and deleted_at is null for update;
 if r.id is null or r.source_kind is distinct from 'native' or r.supplier_id is null then raise exception using errcode='42501',message='RNCP_PDF_NATIVE_ONLY'; end if;
 if r.folio !~ '^RNCP[0-9]+$' then raise exception 'RNCP_FOLIO_REVIEW_REQUIRED'; end if;
 if r.classification is null then raise exception 'RNCP_CLASSIFICATION_REQUIRED'; end if;
 select jsonb_build_object('report',to_jsonb(r),
   'supplier',jsonb_build_object('id',s.id,'code',s.code,'name',s.name),
   'site', (select jsonb_build_object('name',x.name) from public.external_company_sites x where x.id=r.site_id and x.company_id=r.supplier_id),
   'photos',public.iq_rncp_initial_photo_manifest(r.id),
   'actions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'description',a.description,'responsible',a.responsible_name,'dueDate',a.due_date,'status',a.status,'executedAt',a.executed_at,
     'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'sha256',f.sha256) order by f.id)
       from public.supplier_rncp_action_evidence e join public.file_objects f on f.id=e.file_id
       where e.action_id=a.id and f.deleted_at is null and f.workspace_id=org),'[]'::jsonb)) order by a.id)
     from public.supplier_rncp_actions a where a.report_id=r.id),'[]'::jsonb)) into payload
 from public.organizations s where s.id=r.supplier_id and s.kind='supplier' and s.active;
 if payload is null then raise exception 'RNCP_SUPPLIER_INVALID'; end if;
 return jsonb_build_object('snapshot',payload,'fingerprint',encode(extensions.digest(payload::text,'sha256'),'hex'));
end $$;

-- Authenticated callers cannot write rncp-originals objects. Only the backend uploads
-- actual bytes and sets user_metadata. The RPC verifies that protected attestation.
create function public.iq_rncp_register_generated_pdf(p_report uuid,p_fingerprint text,p_file jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snap jsonb; r jsonb; obj storage.objects%rowtype; existing public.file_objects%rowtype;
 org uuid; path text; next_version integer; file_id uuid; bytes bigint; hash text;
begin
 snap:=public.iq_rncp_pdf_snapshot(p_report); r:=snap->'snapshot'->'report'; org:=(r->>'organization_id')::uuid;
 if p_fingerprint is null or p_fingerprint is distinct from snap->>'fingerprint' then raise exception 'RNCP_PDF_CONFLICT'; end if;
 path:='rncp-originals/'||org::text||'/'||auth.uid()::text||'/generated/'||p_report::text||'/'||p_fingerprint||'.pdf';
 select * into existing from public.file_objects where workspace_id=org and resource_type='supplier_rncp_original'
   and resource_id=p_report and resource_key='generated:'||p_fingerprint and deleted_at is null;
 if existing.id is not null then return jsonb_build_object('fileId',existing.id,'version',existing.version,'state','existing'); end if;
 select * into obj from storage.objects where bucket_id='integraq-private' and name=path;
 file_id:=(p_file->>'id')::uuid; bytes:=(p_file->>'sizeBytes')::bigint; hash:=p_file->>'sha256';
 if obj.id is null or file_id is null or bytes is null or hash is null or hash !~ '^[a-f0-9]{64}$' or bytes not between 8 and 4194304
   or obj.metadata->>'mimetype' is distinct from 'application/pdf' or (obj.metadata->>'size')::bigint is distinct from bytes
   or not coalesce(obj.user_metadata @> jsonb_build_object('rncpSnapshot',p_fingerprint,'sha256',hash,'fileId',file_id::text,'actorId',auth.uid()::text),false)
 then raise exception using errcode='42501',message='RNCP_PDF_UNVERIFIED'; end if;
 select coalesce(max(f.version),0)+1 into next_version from public.file_objects f where f.resource_type='supplier_rncp_original' and f.resource_id=p_report;
 update public.file_objects set is_current=false where resource_type='supplier_rncp_original' and resource_id=p_report and is_current;
 insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,audience,
   resource_type,resource_id,resource_key,workspace_id,version,is_current,uploaded_by,preview_status,observations,external_organization_id)
 values(file_id,'integraq-private',path,(r->>'folio')||'-F-CA-25.pdf','application/pdf',bytes,hash,'suppliers','internal',
   'supplier_rncp_original',p_report,'generated:'||p_fingerprint,org,next_version,true,auth.uid(),'not_required',
   jsonb_build_object('kind','generated','snapshot',p_fingerprint,'method','F-CA-25 V1','reportUpdatedAt',r->>'updated_at')::text,(r->>'supplier_id')::uuid);
 insert into public.audit_log(actor_id,module,action,resource_type,resource_id,entity_code_snapshot,previous_value,new_value,metadata)
 values(auth.uid(),'suppliers','rncp.pdf_generated','supplier_rncp_report',p_report::text,r->>'folio',null,
   jsonb_build_object('file_id',file_id,'version',next_version,'sha256',hash),jsonb_build_object('snapshot',p_fingerprint,'notified',false));
 return jsonb_build_object('fileId',file_id,'version',next_version,'state','created');
end $$;
revoke all on function public.iq_rncp_pdf_snapshot(uuid),public.iq_rncp_register_generated_pdf(uuid,text,jsonb) from public,anon;
grant execute on function public.iq_rncp_pdf_snapshot(uuid),public.iq_rncp_register_generated_pdf(uuid,text,jsonb) to authenticated;

-- Runs after iq_rncp_report_guard, so native origin and organization are already established.
create function public.iq_rncp_flow_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare actor_org uuid; reason text:=nullif(trim(current_setting('integraq.rncp.change_reason',true)),'');
begin
 if tg_op='UPDATE' then
   if new.source_kind='native' and (new.closed_at is distinct from old.closed_at and new.closed_at is not null or new.status='closed' and old.status<>'closed')
     and (new.validation_outcome is distinct from 'accepted' or new.validated_at is null or not public.iq_rncp_is_inspector(new.organization_id))
     then raise exception 'RNCP_INSPECTOR_VALIDATION_REQUIRED'; end if;
   if new.folio is distinct from old.folio then raise exception 'RNCP_FOLIO_IMMUTABLE'; end if;
   if new.classification is not distinct from old.classification then return new; end if;
   if old.source_kind='historical' then raise exception 'RNCP_HISTORICAL_IMMUTABLE'; end if;
 end if;
 if new.source_kind='native' or (tg_op='UPDATE' and new.classification is distinct from old.classification) then
   actor_org:=public.iq_rncp_actor_org(false);
   if actor_org is distinct from new.organization_id or not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='RNCP_FORBIDDEN'; end if;
   if new.classification is null then raise exception 'RNCP_CLASSIFICATION_REQUIRED'; end if;
   if tg_op='INSERT' then
     perform pg_advisory_xact_lock(hashtextextended('integraq:rncp:official-folio',0));
     select 'RNCP'||lpad((coalesce(max(substring(r.folio from 5)::numeric),0)+1)::text,
       greatest(4,length((coalesce(max(substring(r.folio from 5)::numeric),0)+1)::text)),'0')
       into new.folio from public.supplier_rncp_reports r where r.folio ~ '^RNCP[0-9]+$';
   else
     if old.status<>'draft' and (reason is null or public.iq_rncp_actor_org(true) is distinct from actor_org) then raise exception 'RNCP_ADMIN_REASON_REQUIRED'; end if;
     insert into public.audit_log(actor_id,module,action,resource_type,resource_id,previous_value,new_value,reason)
       values(auth.uid(),'suppliers','rncp.classification_changed','supplier_rncp_report',new.id::text,
       jsonb_build_object('classification',old.classification),jsonb_build_object('classification',new.classification),reason);
   end if;
 end if;
 return new;
end $$;
revoke all on function public.iq_rncp_flow_guard() from public,anon,authenticated;
create trigger zz_iq_rncp_flow_guard before insert or update on public.supplier_rncp_reports for each row execute function public.iq_rncp_flow_guard();
commit;
