-- IQ-PROV-AUD-01. Proposal only: apply after explicit authorization.
-- No legacy rows, ownership, users, portals or existing upload policies are changed.
begin;
create table public.supplier_audit_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 supplier_id uuid references public.organizations(id) on delete restrict,
 historical_supplier_name text,
 calendar_year integer not null check(calendar_year between 2000 and 2200),
 calendar_month integer not null check(calendar_month between 1 and 12),
 date_precision text not null default 'date' check(date_precision in ('date','week','month')),
 planned_date date, week_start date, actual_date date,
 state text not null default 'scheduled' check(state in ('scheduled','confirmed','rescheduled','pending','cancelled','performed','completed')),
 criteria text not null default '', audit_method text not null default '', responsible_names text not null default '', observations text not null default '',
 source_sha256 text,source_sheet text,source_row integer,source_column text,source_payload jsonb,source_status text,
 revision integer not null default 1,
 created_by uuid not null references public.profiles(id) on delete restrict,
 updated_by uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((source_sha256 is null and supplier_id is not null) or (source_sha256 is not null and historical_supplier_name is not null)),
 check(date_precision<>'date' or planned_date is not null),
 check(date_precision<>'week' or week_start is not null),
 check(planned_date is null or (extract(year from planned_date)=calendar_year and extract(month from planned_date)=calendar_month)),
 check(week_start is null or (extract(year from week_start)=calendar_year and extract(month from week_start)=calendar_month)),
 unique(organization_id,source_sha256,source_sheet,source_row,source_column)
);
create index supplier_audit_events_calendar on public.supplier_audit_events(organization_id,calendar_year,calendar_month);
create index supplier_audit_events_supplier on public.supplier_audit_events(organization_id,supplier_id);
alter table public.supplier_assessments
 add column audit_event_id uuid unique references public.supplier_audit_events(id) on delete restrict,
 add column questionnaire text check(questionnaire in ('manufacturers','distributors')),
 add column rubric_scores jsonb,
 add column findings text,
 add column audit_report_file_id uuid references public.file_objects(id) on delete restrict,
 add column action_plan_file_id uuid references public.file_objects(id) on delete restrict;

create function public.iq_supplier_audit_org() returns uuid language plpgsql stable security definer set search_path='' as $$
declare selected_org uuid;
begin
 select p.organization_id into selected_org from public.profiles p join public.organizations o on o.id=p.organization_id
 where p.id=auth.uid() and p.status='active' and p.user_type in ('administrator','internal') and p.workspace_mode='production'
 and o.kind='internal' and o.active and public.has_module_permission('suppliers','view');
 if selected_org is null then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
 return selected_org;
end $$;
create function public.iq_supplier_audit_inspector(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.workspace_data w on w.workspace_id=p.organization_id
 where p.id=auth.uid() and p.organization_id=p_org and p.status='active' and p.user_type in ('internal','administrator') and p.workspace_mode='production'
 and w.workspace_mode='production' and w.area='supplierAuditSettings' and w.deleted_at is null
 and coalesce(w.payload->'inspectorIds','[]'::jsonb) ? p.id::text
 and public.has_module_permission('suppliers','update'))
$$;
create function public.iq_supplier_audit_supplier_allowed(p_supplier uuid,p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organizations o where o.id=p_supplier and o.kind='supplier' and (
 o.owning_organization_id=p_org or (o.owning_organization_id is null and exists(select 1 from public.workspace_data w
 where w.workspace_id=p_org and w.workspace_mode='production' and w.area='supplierAuditSettings' and w.deleted_at is null
 and coalesce(w.payload->'legacySupplierIds','[]'::jsonb) ? o.id::text))))
$$;
create function public.iq_supplier_audit_can_read(p_event uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare selected_org uuid;
begin
 begin selected_org:=public.iq_supplier_audit_org(); exception when insufficient_privilege then return false; end;
 return exists(select 1 from public.supplier_audit_events e where e.id=p_event and e.organization_id=selected_org);
end $$;
create function public.iq_supplier_audit_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare selected_org uuid:=public.iq_supplier_audit_org();
begin
 return jsonb_build_object('organizationId',selected_org,'canManage',public.iq_supplier_audit_inspector(selected_org),
 'administrator',exists(select 1 from public.profiles where id=auth.uid() and user_type='administrator'));
end $$;
create function public.iq_supplier_audit_log(p_action text,p_id uuid,p_before jsonb,p_after jsonb,p_reason text default null) returns void language sql security definer set search_path='' as $$
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,previous_value,new_value,reason,user_name_snapshot,metadata)
 select p.id,p.organization_id,'suppliers',p_action,'supplier_audit_event',p_id::text,p_before,p_after,p_reason,p.full_name,
 jsonb_build_object('notificationEvent',p_action,'delivery','disabled','externalPublication',false)
 from public.profiles p where p.id=auth.uid() and p.status='active';
$$;

-- Configuration is explicit: administrators are not automatically inspectors.
create function public.iq_supplier_audit_configure(p_inspectors uuid[],p_legacy_suppliers uuid[],p_expected_revision integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare selected_org uuid:=public.iq_supplier_audit_org(); previous public.workspace_data%rowtype; candidate uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and user_type='administrator') then raise exception using errcode='42501',message='AUDIT_ADMIN_REQUIRED'; end if;
 if length(trim(coalesce(p_reason,'')))<5 or cardinality(p_inspectors)>30 or cardinality(p_legacy_suppliers)>2000 or p_inspectors is null or p_legacy_suppliers is null then raise exception 'AUDIT_CONFIGURATION_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtext('supplierAuditSettings'));
 select * into previous from public.workspace_data where workspace_id=selected_org and workspace_mode='production' and area='supplierAuditSettings' for update;
 if coalesce(previous.revision,0)<>p_expected_revision then raise exception 'AUDIT_CONFLICT'; end if;
 foreach candidate in array p_inspectors loop
  if not exists(select 1 from public.profiles p where p.id=candidate and p.organization_id=selected_org and p.status='active' and p.user_type in ('internal','administrator') and p.workspace_mode='production'
   and (p.user_type='administrator' or exists(select 1 from public.user_module_action_permissions u where u.user_id=p.id and u.module_id='suppliers' and u.action='update')))
  then raise exception 'AUDIT_INSPECTOR_PERMISSION_REQUIRED'; end if;
 end loop;
 foreach candidate in array p_legacy_suppliers loop
  if not exists(select 1 from public.organizations where id=candidate and kind='supplier' and active and (owning_organization_id is null or owning_organization_id=selected_org))
   or exists(select 1 from public.workspace_data w where w.workspace_id<>selected_org and w.workspace_mode='production' and w.area='supplierAuditSettings' and w.deleted_at is null and coalesce(w.payload->'legacySupplierIds','[]'::jsonb) ? candidate::text)
  then raise exception 'AUDIT_SUPPLIER_SCOPE_UNVERIFIED'; end if;
 end loop;
 insert into public.workspace_data(workspace_id,workspace_mode,area,payload,revision,created_by,updated_by)
 values(selected_org,'production','supplierAuditSettings',jsonb_build_object('inspectorIds',to_jsonb(p_inspectors),'legacySupplierIds',to_jsonb(p_legacy_suppliers)),1,auth.uid(),auth.uid())
 on conflict(workspace_id,workspace_mode,area) do update set payload=excluded.payload,revision=public.workspace_data.revision+1,updated_by=auth.uid(),updated_at=now(),deleted_at=null;
 perform public.iq_supplier_audit_log('audit.configuration',selected_org,previous.payload,jsonb_build_object('inspectorIds',p_inspectors,'legacySupplierIds',p_legacy_suppliers),p_reason);
end $$;

create function public.iq_supplier_audit_save(p_id uuid,p_expected_revision integer,p_payload jsonb,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare selected_org uuid:=public.iq_supplier_audit_org(); previous public.supplier_audit_events%rowtype; saved public.supplier_audit_events%rowtype; selected_supplier uuid; selected_state text; selected_precision text;
begin
 if not public.iq_supplier_audit_inspector(selected_org) then raise exception using errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; end if;
 if p_id is not null then
  select * into previous from public.supplier_audit_events where id=p_id and organization_id=selected_org for update;
  if previous.id is null then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
  if previous.revision<>p_expected_revision then raise exception 'AUDIT_CONFLICT'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'AUDIT_REASON_REQUIRED'; end if;
  if previous.state='completed' then raise exception 'AUDIT_FINALIZED_USE_RESULT_CORRECTION'; end if;
 end if;
 selected_supplier:=nullif(p_payload->>'supplierId','')::uuid;
 if selected_supplier is null or not public.iq_supplier_audit_supplier_allowed(selected_supplier,selected_org) then raise exception 'AUDIT_SUPPLIER_SCOPE_UNVERIFIED'; end if;
 if not exists(select 1 from public.organizations where id=selected_supplier and active) then raise exception 'AUDIT_SUPPLIER_INACTIVE'; end if;
 if previous.supplier_id is not null and selected_supplier<>previous.supplier_id then raise exception 'AUDIT_SUPPLIER_IMMUTABLE'; end if;
 if previous.supplier_id is null and previous.id is not null and exists(select 1 from public.file_objects where resource_id=previous.id and resource_type in ('supplier_audit_report','supplier_audit_action_plan')) then raise exception 'AUDIT_RECONCILIATION_BLOCKED'; end if;
 selected_state:=coalesce(p_payload->>'state','scheduled'); selected_precision:=p_payload->>'precision';
 if selected_state not in ('scheduled','confirmed','rescheduled','pending','cancelled','performed') then raise exception 'AUDIT_STATE_INVALID'; end if;
 if previous.id is null and selected_state not in ('scheduled','confirmed','pending') then raise exception 'AUDIT_INITIAL_STATE_INVALID'; end if;
 if selected_state='confirmed' and selected_precision<>'date' then raise exception 'AUDIT_EXACT_DATE_REQUIRED'; end if;
 if previous.id is not null and selected_state<>'cancelled' and previous.actual_date is not null and nullif(p_payload->>'actualDate','')::date is distinct from previous.actual_date and previous.source_sha256 is not null then raise exception 'AUDIT_HISTORICAL_ACTUAL_DATE_IMMUTABLE'; end if;
 if selected_state='performed' and (nullif(p_payload->>'actualDate','') is null or (not (previous.source_sha256 is not null and previous.actual_date is not null and previous.state='performed') and not exists(select 1 from public.file_objects f join storage.objects o on o.bucket_id=f.bucket_id and o.name=f.object_path where f.resource_id=previous.id and f.resource_type='supplier_audit_report' and f.is_current and f.deleted_at is null))) then raise exception 'AUDIT_ACTUAL_DATE_AND_REPORT_REQUIRED'; end if;
 if previous.source_sha256 is not null and previous.state='performed' and nullif(p_payload->>'actualDate','')::date is distinct from previous.actual_date then raise exception 'AUDIT_HISTORICAL_ACTUAL_DATE_IMMUTABLE'; end if;
 if previous.id is null then
  insert into public.supplier_audit_events(organization_id,supplier_id,calendar_year,calendar_month,date_precision,planned_date,week_start,state,criteria,audit_method,responsible_names,observations,created_by,updated_by)
  values(selected_org,selected_supplier,(p_payload->>'year')::int,(p_payload->>'month')::int,selected_precision,nullif(p_payload->>'plannedDate','')::date,nullif(p_payload->>'weekStart','')::date,selected_state,
   coalesce(p_payload->>'criteria',''),coalesce(p_payload->>'method',''),coalesce(p_payload->>'responsible',''),coalesce(p_payload->>'observations',''),auth.uid(),auth.uid()) returning * into saved;
 else
  update public.supplier_audit_events set supplier_id=selected_supplier,calendar_year=(p_payload->>'year')::int,calendar_month=(p_payload->>'month')::int,date_precision=selected_precision,
   planned_date=nullif(p_payload->>'plannedDate','')::date,week_start=nullif(p_payload->>'weekStart','')::date,actual_date=coalesce(previous.actual_date,nullif(p_payload->>'actualDate','')::date),state=selected_state,
   criteria=coalesce(p_payload->>'criteria',''),audit_method=coalesce(p_payload->>'method',''),responsible_names=coalesce(p_payload->>'responsible',''),observations=coalesce(p_payload->>'observations',''),
   revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=previous.id returning * into saved;
 end if;
 if saved.actual_date>current_date then raise exception 'AUDIT_ACTUAL_DATE_IN_FUTURE'; end if;
 perform public.iq_supplier_audit_log(case when previous.id is null then 'audit.created' when saved.state='cancelled' then 'audit.cancelled' when saved.planned_date is distinct from previous.planned_date or saved.week_start is distinct from previous.week_start then 'audit.rescheduled' else 'audit.updated' end,saved.id,to_jsonb(previous),to_jsonb(saved),p_reason);
 return saved.id;
end $$;

create function public.iq_supplier_audit_import(p_sha text,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare selected_org uuid:=public.iq_supplier_audit_org(); item jsonb; inserted_id uuid; existing public.supplier_audit_events%rowtype; added integer:=0; skipped integer:=0; selected_supplier uuid;
begin
 if not public.iq_supplier_audit_inspector(selected_org) then raise exception using errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; end if;
 if p_sha is distinct from '28f5784c76c2cb077f9d0aae69c8de10175f2c66f7b1ad130c98e7261ff164df' or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>22 then raise exception 'AUDIT_SOURCE_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtext(selected_org::text||'F-CA-58'));
 for item in select value from jsonb_array_elements(p_rows) loop
  if item->>'sourceSheet' not in ('2025 JUL-ENE','2026 FEB-JUL','2026 AGO-ENE') or (item->>'sourceRow')::int not between 12 and 33 or item->>'state' not in ('performed','cancelled','pending') or jsonb_array_length(item->'sourcePayload'->'rowValues')<>35 then raise exception 'AUDIT_SOURCE_ROW_INVALID'; end if;
  selected_supplier:=nullif(item->>'supplierId','')::uuid;
  if selected_supplier is not null and not public.iq_supplier_audit_supplier_allowed(selected_supplier,selected_org) then raise exception 'AUDIT_SUPPLIER_SCOPE_UNVERIFIED'; end if;
  select * into existing from public.supplier_audit_events where organization_id=selected_org and source_sha256=p_sha and source_sheet=item->>'sourceSheet' and source_row=(item->>'sourceRow')::int and source_column=item->>'sourceColumn';
  if existing.id is not null then
   if existing.source_payload is distinct from item->'sourcePayload' then raise exception 'AUDIT_SOURCE_CONFLICT'; end if;
   skipped:=skipped+1; continue;
  end if;
  insert into public.supplier_audit_events(organization_id,supplier_id,historical_supplier_name,calendar_year,calendar_month,date_precision,planned_date,actual_date,state,criteria,audit_method,responsible_names,observations,source_sha256,source_sheet,source_row,source_column,source_payload,source_status,created_by,updated_by)
  values(selected_org,selected_supplier,item->>'supplierName',(item->>'year')::int,(item->>'month')::int,case when nullif(item->>'plannedDate','') is null then 'month' else 'date' end,
   nullif(item->>'plannedDate','')::date,nullif(item->>'actualDate','')::date,item->>'state',item->>'criteria',item->>'method',item->>'responsible',coalesce(item->>'observations',''),
   p_sha,item->>'sourceSheet',(item->>'sourceRow')::int,item->>'sourceColumn',item->'sourcePayload',item->>'sourceStatus',auth.uid(),auth.uid()) returning id into inserted_id;
  perform public.iq_supplier_audit_log('audit.history.imported',inserted_id,null,item,'Importación F-CA-58; sin informe ni publicación inferidos'); added:=added+1;
 end loop;
 if (select count(*) from public.supplier_audit_events where organization_id=selected_org and source_sha256=p_sha)<>22 then raise exception 'AUDIT_INCOMPLETE_IMPORT'; end if;
 return jsonb_build_object('inserted',added,'existing',skipped,'notificationsSent',0);
end $$;

insert into public.file_upload_policies(resource_type,max_size_bytes,allowed_mime_types)
values('supplier_audit_report',4194304,array['application/pdf']),('supplier_audit_action_plan',4194304,array['application/pdf']) on conflict(resource_type) do nothing;
create function public.iq_supplier_audit_file(p_event uuid,p_revision integer,p_file jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare selected_org uuid:=public.iq_supplier_audit_org(); event_row public.supplier_audit_events%rowtype; file_id uuid; previous_file uuid; next_version integer; selected_type text:=p_file->>'type'; selected_path text:=p_file->>'path';
begin
 if not public.iq_supplier_audit_inspector(selected_org) then raise exception using errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; end if;
 select * into event_row from public.supplier_audit_events where id=p_event and organization_id=selected_org for update;
 if event_row.id is null or event_row.supplier_id is null or not public.iq_supplier_audit_supplier_allowed(event_row.supplier_id,selected_org) then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
 if event_row.revision<>p_revision then raise exception 'AUDIT_CONFLICT'; end if;
 if event_row.state='cancelled' then raise exception 'AUDIT_CANCELLED'; end if;
 if length(trim(coalesce(p_file->>'reason','')))<5 then raise exception 'AUDIT_REASON_REQUIRED'; end if;
 if coalesce(selected_type,'') not in ('supplier_audit_report','supplier_audit_action_plan') or p_file->>'mime' is distinct from 'application/pdf' or coalesce(p_file->>'sha256','') !~ '^[a-f0-9]{64}$'
 or not exists(select 1 from public.file_upload_policies where resource_type=selected_type and (p_file->>'size')::bigint between 1 and least(max_size_bytes,4194304) and 'application/pdf'=any(allowed_mime_types))
 or selected_path not like auth.uid()::text||'/supplier-audits/'||p_event::text||'/%'
 or not exists(select 1 from storage.objects o where o.bucket_id='integraq-private' and o.name=selected_path and (o.metadata->>'size')::bigint=(p_file->>'size')::bigint and o.metadata->>'mimetype'='application/pdf')
 then raise exception 'AUDIT_FILE_INVALID'; end if;
 select id into file_id from public.file_objects where resource_id=p_event and resource_type=selected_type and sha256=p_file->>'sha256' and deleted_at is null limit 1;
 if file_id is not null then return file_id; end if;
 select id into previous_file from public.file_objects where resource_id=p_event and resource_type=selected_type and is_current order by version desc limit 1;
 select coalesce(max(version),0)+1 into next_version from public.file_objects where resource_id=p_event and resource_type=selected_type;
 update public.file_objects set is_current=false,updated_at=now() where resource_id=p_event and resource_type=selected_type and is_current;
 insert into public.file_objects(bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,workspace_id,external_organization_id,audience,resource_type,resource_id,resource_key,version,is_current,replaces_file_id,uploaded_by,preview_status)
 values('integraq-private',selected_path,left(p_file->>'name',240),'application/pdf',(p_file->>'size')::bigint,p_file->>'sha256','suppliers',selected_org,event_row.supplier_id,'internal',selected_type,p_event,p_event::text,next_version,true,previous_file,auth.uid(),'pending') returning id into file_id;
 update public.supplier_audit_events set revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=p_event;
 -- New PDF does not silently change a finalized result. Explicit result correction is required.
 perform public.iq_supplier_audit_log('audit.report.attached',p_event,jsonb_build_object('previousFile',previous_file),jsonb_build_object('fileId',file_id,'version',next_version,'type',selected_type),p_file->>'reason');
 return file_id;
end $$;

create function public.iq_supplier_audit_result(p_event uuid,p_revision integer,p_result jsonb,p_finalize boolean,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare selected_org uuid:=public.iq_supplier_audit_org(); e public.supplier_audit_events%rowtype; previous public.supplier_assessments%rowtype; result_id uuid; expected_count integer; rubric integer; report_id uuid:=nullif(p_result->>'reportId','')::uuid; plan_id uuid:=nullif(p_result->>'planId','')::uuid;
begin
 if not public.iq_supplier_audit_inspector(selected_org) then raise exception using errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; end if;
 select * into e from public.supplier_audit_events where id=p_event and organization_id=selected_org for update;
 if e.id is null or e.supplier_id is null or not public.iq_supplier_audit_supplier_allowed(e.supplier_id,selected_org) then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
 if e.revision<>p_revision then raise exception 'AUDIT_CONFLICT'; end if;
 if e.state='cancelled' then raise exception 'AUDIT_CANCELLED'; end if;
 if coalesce(p_result->>'questionnaire','') not in ('manufacturers','distributors') then raise exception 'AUDIT_QUESTIONNAIRE_REQUIRED'; end if;
 expected_count:=case when p_result->>'questionnaire'='manufacturers' then 9 else 8 end;
 if jsonb_typeof(p_result->'scores') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_result->'scores'))<>expected_count then raise exception 'AUDIT_SCORES_INVALID'; end if;
 for rubric in 1..expected_count loop
  if jsonb_typeof(p_result->'scores'->rubric::text) is distinct from 'number' or not ((p_result->'scores'->>rubric::text)::numeric between 0 and 100) then raise exception 'AUDIT_SCORES_INVALID'; end if;
 end loop;
 if jsonb_typeof(p_result->'score') is distinct from 'number' or not ((p_result->>'score')::numeric between 0 and 100) or length(trim(coalesce(p_result->>'auditor','')))<2
 or nullif(p_result->>'evaluationDate','') is null or (p_result->>'evaluationDate')::date>current_date then raise exception 'AUDIT_RESULT_INVALID'; end if;
 if not exists(select 1 from public.file_objects f join storage.objects o on o.bucket_id=f.bucket_id and o.name=f.object_path where f.id=report_id and f.resource_id=e.id and f.resource_type='supplier_audit_report' and f.external_organization_id=e.supplier_id and f.workspace_id=selected_org and f.is_current and f.deleted_at is null) then raise exception 'AUDIT_PDF_REQUIRED'; end if;
 if plan_id is not null and not exists(select 1 from public.file_objects where id=plan_id and resource_id=e.id and resource_type='supplier_audit_action_plan' and deleted_at is null) then raise exception 'AUDIT_PLAN_INVALID'; end if;
 if nullif(p_result->>'actualDate','') is null or (p_result->>'actualDate')::date>current_date or (e.source_sha256 is not null and e.actual_date is not null and e.actual_date<>(p_result->>'actualDate')::date) then raise exception 'AUDIT_ACTUAL_DATE_INVALID'; end if;
 select * into previous from public.supplier_assessments where audit_event_id=e.id for update;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'AUDIT_REASON_REQUIRED'; end if;
 insert into public.supplier_assessments(supplier_id,assessment_type,assessment_date,evaluator_name,score,classification,observations,portal_visible,created_by,updated_by,audit_event_id,questionnaire,rubric_scores,findings,audit_report_file_id,action_plan_file_id)
 values(e.supplier_id,'supplier_audit',(p_result->>'evaluationDate')::date,trim(p_result->>'auditor'),(p_result->>'score')::numeric,nullif(p_result->>'classification',''),p_result->>'observations',false,auth.uid(),auth.uid(),e.id,p_result->>'questionnaire',p_result->'scores',p_result->>'findings',report_id,plan_id)
 on conflict(audit_event_id) do update set assessment_date=excluded.assessment_date,evaluator_name=excluded.evaluator_name,score=excluded.score,classification=excluded.classification,observations=excluded.observations,updated_by=auth.uid(),questionnaire=excluded.questionnaire,rubric_scores=excluded.rubric_scores,findings=excluded.findings,audit_report_file_id=report_id,action_plan_file_id=plan_id returning id into result_id;
 update public.supplier_audit_events set state=case when p_finalize then 'completed' else 'performed' end,actual_date=(p_result->>'actualDate')::date,revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=e.id;
 perform public.iq_supplier_audit_log(case when p_finalize then 'audit.completed' else 'audit.result.saved' end,e.id,jsonb_build_object('event',to_jsonb(e),'result',to_jsonb(previous)),p_result||jsonb_build_object('assessmentId',result_id),p_reason);
 return result_id;
end $$;

-- Contact edits never change official IDs/codes, ownership, accounts or access.
create function public.iq_supplier_audit_contacts(p_supplier uuid,p_contacts jsonb,p_expected_updated_at timestamptz,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare selected_org uuid:=public.iq_supplier_audit_org(); company public.organizations%rowtype; safe_contacts jsonb;
begin
 if not public.iq_supplier_audit_inspector(selected_org) and not exists(select 1 from public.profiles where id=auth.uid() and user_type='administrator') then raise exception using errcode='42501',message='AUDIT_CONTACTS_DENIED'; end if;
 select * into company from public.organizations where id=p_supplier and kind='supplier' for update;
 if company.id is null or not public.iq_supplier_audit_supplier_allowed(p_supplier,selected_org) then raise exception 'AUDIT_SUPPLIER_SCOPE_UNVERIFIED'; end if;
 if company.updated_at is distinct from p_expected_updated_at then raise exception 'AUDIT_CONFLICT'; end if;
 if length(trim(coalesce(p_reason,'')))<5 or jsonb_typeof(p_contacts) is distinct from 'object' or length(p_contacts::text)>10000 then raise exception 'AUDIT_CONTACTS_INVALID'; end if;
 if coalesce(p_contacts->>'email','')<>'' and p_contacts->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'AUDIT_EMAIL_INVALID'; end if;
 if coalesce(p_contacts->>'alternateEmail','')<>'' and p_contacts->>'alternateEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'AUDIT_EMAIL_INVALID'; end if;
 if p_contacts->>'emailVerified'='true' and (coalesce(p_contacts->>'email','')='' or coalesce(p_contacts->>'notificationName','')='') then raise exception 'AUDIT_CONFIRMED_RECIPIENT_REQUIRED'; end if;
 safe_contacts:=jsonb_build_object('qualityName',p_contacts->>'qualityName','notificationName',p_contacts->>'notificationName','email',lower(trim(p_contacts->>'email')),
 'phone',p_contacts->>'phone','alternateName',p_contacts->>'alternateName','alternateEmail',p_contacts->>'alternateEmail','alternatePhone',p_contacts->>'alternatePhone','notes',p_contacts->>'notes',
 'emailVerified',coalesce((p_contacts->>'emailVerified')::boolean,false),'emailVerifiedAt',case when p_contacts->>'emailVerified'='true' then now() else null end,'verifiedBy',case when p_contacts->>'emailVerified'='true' then auth.uid() else null end,'updatedBy',auth.uid());
 update public.organizations set metadata=jsonb_set(metadata,'{supplierQualityContacts}',safe_contacts),updated_at=now() where id=p_supplier;
 perform public.iq_supplier_audit_log('audit.supplier.contacts.updated',p_supplier,company.metadata->'supplierQualityContacts',safe_contacts,p_reason);
end $$;

alter table public.supplier_audit_events enable row level security;
grant select on public.supplier_audit_events to authenticated;
grant all on public.supplier_audit_events to service_role;
create policy supplier_audit_events_read on public.supplier_audit_events for select to authenticated using(public.iq_supplier_audit_can_read(id));
create policy supplier_audit_result_scope on public.supplier_assessments as restrictive for select to authenticated using(audit_event_id is null or public.iq_supplier_audit_can_read(audit_event_id));
create policy supplier_audit_result_insert on public.supplier_assessments as restrictive for insert to authenticated with check(audit_event_id is null and assessment_type<>'supplier_audit');
create policy supplier_audit_result_update on public.supplier_assessments as restrictive for update to authenticated using(audit_event_id is null) with check(audit_event_id is null);
create policy supplier_audit_result_delete on public.supplier_assessments as restrictive for delete to authenticated using(audit_event_id is null);
create function public.iq_supplier_audit_legacy_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' and new.assessment_type='supplier_audit' and new.audit_event_id is null then raise exception 'AUDIT_CALENDAR_REQUIRED'; end if;
 if tg_op='UPDATE' and old.assessment_type<>'supplier_audit' and new.assessment_type='supplier_audit' and new.audit_event_id is null then raise exception 'AUDIT_CALENDAR_REQUIRED'; end if;
 if (new.audit_event_id is not null or (tg_op='UPDATE' and old.audit_event_id is not null)) and current_user<>'postgres' then raise exception using errcode='42501',message='AUDIT_RESULT_RPC_REQUIRED'; end if;
 if new.audit_event_id is not null and (new.portal_visible or new.source_file_id is not null or new.assessment_type<>'supplier_audit' or not exists(select 1 from public.supplier_audit_events where id=new.audit_event_id and supplier_id=new.supplier_id)) then raise exception 'AUDIT_RESULT_SCOPE_INVALID'; end if;
 if tg_op='UPDATE' and old.audit_event_id is not null and new.audit_event_id is distinct from old.audit_event_id then raise exception 'AUDIT_RESULT_IDENTITY_IMMUTABLE'; end if;
 return new;
end $$;
create trigger supplier_audit_result_guard before insert or update on public.supplier_assessments for each row execute function public.iq_supplier_audit_legacy_guard();
create policy supplier_audit_files_private on public.file_objects as restrictive for all to authenticated using(resource_type not in ('supplier_audit_report','supplier_audit_action_plan')) with check(resource_type not in ('supplier_audit_report','supplier_audit_action_plan'));
create policy supplier_audit_storage_private on storage.objects as restrictive for all to authenticated using(name not like '%/supplier-audits/%') with check(name not like '%/supplier-audits/%');
create policy supplier_audit_settings_read on public.workspace_data as restrictive for select to authenticated using(area<>'supplierAuditSettings' or (workspace_id=public.iq_supplier_audit_org() and workspace_mode='production'));
create policy supplier_audit_settings_insert on public.workspace_data as restrictive for insert to authenticated with check(area<>'supplierAuditSettings');
create policy supplier_audit_settings_update on public.workspace_data as restrictive for update to authenticated using(area<>'supplierAuditSettings') with check(area<>'supplierAuditSettings');
create policy supplier_audit_settings_delete on public.workspace_data as restrictive for delete to authenticated using(area<>'supplierAuditSettings');
create function public.iq_supplier_audit_contact_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind='supplier' and new.metadata->'supplierQualityContacts' is distinct from old.metadata->'supplierQualityContacts' and current_user<>'postgres' then raise exception using errcode='42501',message='AUDIT_CONTACTS_RPC_REQUIRED'; end if;
 return new;
end $$;
create trigger supplier_audit_contact_guard before update on public.organizations for each row execute function public.iq_supplier_audit_contact_guard();

-- Helpers are not public endpoints. Only authenticated, scoped RPC entry points are callable.
revoke all on function public.iq_supplier_audit_org(),public.iq_supplier_audit_inspector(uuid),public.iq_supplier_audit_supplier_allowed(uuid,uuid),public.iq_supplier_audit_can_read(uuid),public.iq_supplier_audit_context(),public.iq_supplier_audit_log(text,uuid,jsonb,jsonb,text),public.iq_supplier_audit_configure(uuid[],uuid[],integer,text),public.iq_supplier_audit_save(uuid,integer,jsonb,text),public.iq_supplier_audit_import(text,jsonb),public.iq_supplier_audit_file(uuid,integer,jsonb),public.iq_supplier_audit_result(uuid,integer,jsonb,boolean,text),public.iq_supplier_audit_contacts(uuid,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.iq_supplier_audit_org(),public.iq_supplier_audit_can_read(uuid),public.iq_supplier_audit_context(),public.iq_supplier_audit_configure(uuid[],uuid[],integer,text),public.iq_supplier_audit_save(uuid,integer,jsonb,text),public.iq_supplier_audit_import(text,jsonb),public.iq_supplier_audit_file(uuid,integer,jsonb),public.iq_supplier_audit_result(uuid,integer,jsonb,boolean,text),public.iq_supplier_audit_contacts(uuid,jsonb,timestamptz,text) to authenticated;
notify pgrst,'reload schema';
commit;
