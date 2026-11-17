-- IQ-PROV-MEJORAS-02 / supplier audit withdrawal. PROPOSAL ONLY; NOT EXECUTED.
-- Apply this file alone after explicit approval of SHA-256 and target.
-- No imports, backfills, record deletions, Storage changes or notifications.
-- Existing definitions pinned to the catalog evidence captured 2026-11-09.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
BEGIN
  if to_regprocedure('public.iq_supplier_audit_save(uuid,integer,jsonb,text)') is null or md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_save(uuid,integer,jsonb,text)'))) is distinct from '9a48effba6c53ce5395a9bb7258d67a9' then raise exception 'AUDIT_WITHDRAWAL_DEPENDENCY_CHANGED: iq_supplier_audit_save'; end if;
  if to_regprocedure('public.iq_supplier_audit_file(uuid,integer,jsonb)') is null or md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_file(uuid,integer,jsonb)'))) is distinct from 'e941c76fc18c939527ddee147cacac7e' then raise exception 'AUDIT_WITHDRAWAL_DEPENDENCY_CHANGED: iq_supplier_audit_file'; end if;
  if to_regprocedure('public.iq_supplier_audit_result(uuid,integer,jsonb,boolean,text)') is null or md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_result(uuid,integer,jsonb,boolean,text)'))) is distinct from 'ae49f78bfca8544c4a961fd406a3d996' then raise exception 'AUDIT_WITHDRAWAL_DEPENDENCY_CHANGED: iq_supplier_audit_result'; end if;
  if to_regprocedure('public.iq_supplier_audit_context()') is null or md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_context()'))) is distinct from '7a684208dd2dccc5dd51243a075e44a5' then raise exception 'AUDIT_WITHDRAWAL_DEPENDENCY_CHANGED: iq_supplier_audit_context'; end if;
  if to_regprocedure('public.iq_supplier_audit_log(text,uuid,jsonb,jsonb,text)') is null or md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_log(text,uuid,jsonb,jsonb,text)'))) is distinct from 'd07864f7f1ffcfab7b5c6931834e7d98' then raise exception 'AUDIT_WITHDRAWAL_DEPENDENCY_CHANGED: iq_supplier_audit_log'; end if;
  if to_regprocedure('public.iq_supplier_audit_set_withdrawn(uuid,integer,boolean,text)') is not null then
    raise exception 'AUDIT_WITHDRAWAL_ALREADY_INSTALLED_REVIEW_REQUIRED';
  end if;
END;
$preflight$;

ALTER TABLE public.supplier_audit_events
  ADD COLUMN withdrawn_at timestamptz,
  ADD COLUMN withdrawn_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN withdrawal_reason text,
  ADD CONSTRAINT supplier_audit_withdrawal_complete CHECK (
    (withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawal_reason IS NULL)
    OR (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdrawal_reason IS NOT NULL
      AND char_length(btrim(withdrawal_reason)) BETWEEN 5 AND 2000)
  );

CREATE FUNCTION public.iq_supplier_audit_set_withdrawn(
  p_event uuid, p_expected_revision integer, p_withdrawn boolean, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $withdraw$
DECLARE
  selected_org uuid := public.iq_supplier_audit_org();
  previous public.supplier_audit_events%rowtype;
  saved public.supplier_audit_events%rowtype;
  reason text := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  action_name text;
BEGIN
  -- Fresh authorization before a row lock, even for direct RPC calls.
  if not public.iq_supplier_audit_inspector(selected_org) or not exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.organization_id=selected_org
      and p.user_type='administrator' and p.status='active' and p.workspace_mode='production'
  ) then raise exception using errcode='42501', message='AUDIT_ADMIN_REQUIRED'; end if;
  if p_event is null or p_expected_revision is null or p_expected_revision<1 or p_withdrawn is null then
    raise exception 'AUDIT_WITHDRAWAL_INPUT';
  end if;
  if reason is null or char_length(reason) not between 5 and 2000 then raise exception 'AUDIT_WITHDRAWAL_REASON'; end if;
  select * into previous from public.supplier_audit_events
    where id=p_event and organization_id=selected_org for update;
  if not found then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
  if previous.revision is distinct from p_expected_revision then raise exception 'AUDIT_CONFLICT'; end if;
  if (previous.withdrawn_at is not null)=p_withdrawn then raise exception 'AUDIT_WITHDRAWAL_TRANSITION'; end if;
  update public.supplier_audit_events set
    withdrawn_at=case when p_withdrawn then now() else null end,
    withdrawn_by=case when p_withdrawn then auth.uid() else null end,
    withdrawal_reason=case when p_withdrawn then reason else null end,
    revision=revision+1, updated_at=now(), updated_by=auth.uid()
    where id=previous.id and organization_id=selected_org returning * into saved;
  action_name:=case when p_withdrawn then 'audit.withdrawn' else 'audit.restored' end;
  perform public.iq_supplier_audit_log(action_name,saved.id,to_jsonb(previous),to_jsonb(saved),reason);
  -- The existing helper can insert zero rows if a profile becomes inactive: fail atomically.
  if not exists(select 1 from public.audit_log l where l.resource_type='supplier_audit_event'
    and l.resource_id=saved.id::text and l.organization_id=selected_org and l.actor_id=auth.uid()
    and l.action=action_name and l.reason=reason
    and l.previous_value=to_jsonb(previous) and l.new_value=to_jsonb(saved))
  then raise exception 'AUDIT_WITHDRAWAL_LOG_REQUIRED'; end if;
  return jsonb_build_object('id',saved.id,'revision',saved.revision,'withdrawn_at',saved.withdrawn_at);
END;
$withdraw$;
ALTER FUNCTION public.iq_supplier_audit_set_withdrawn(uuid,integer,boolean,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.iq_supplier_audit_set_withdrawn(uuid,integer,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iq_supplier_audit_set_withdrawn(uuid,integer,boolean,text) TO authenticated;

-- Existing iq_supplier_audit_save: only add the withdrawal guard after the scoped lock/revision check.
CREATE OR REPLACE FUNCTION public.iq_supplier_audit_save(p_id uuid, p_expected_revision integer, p_payload jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_org uuid:=public.iq_supplier_audit_org(); previous public.supplier_audit_events%rowtype; saved public.supplier_audit_events%rowtype; selected_supplier uuid; selected_state text; selected_precision text;
begin
 if not public.iq_supplier_audit_inspector(selected_org) then raise exception using errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; end if;
 if p_id is not null then
  select * into previous from public.supplier_audit_events where id=p_id and organization_id=selected_org for update;
  if previous.id is null then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
  if previous.revision is distinct from p_expected_revision then raise exception 'AUDIT_CONFLICT'; end if;
  if previous.withdrawn_at is not null then raise exception 'AUDIT_WITHDRAWN'; end if;
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
end $function$;

-- Existing iq_supplier_audit_file: only add the withdrawal guard after the scoped lock/revision check.
CREATE OR REPLACE FUNCTION public.iq_supplier_audit_file(p_event uuid, p_revision integer, p_file jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_org uuid:=public.iq_supplier_audit_org(); event_row public.supplier_audit_events%rowtype; file_id uuid; previous_file uuid; next_version integer; selected_type text:=p_file->>'type'; selected_path text:=p_file->>'path';
begin
 if not public.iq_supplier_audit_inspector(selected_org) then raise exception using errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; end if;
 select * into event_row from public.supplier_audit_events where id=p_event and organization_id=selected_org for update;
 if event_row.id is null or event_row.supplier_id is null or not public.iq_supplier_audit_supplier_allowed(event_row.supplier_id,selected_org) then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
 if event_row.revision is distinct from p_revision then raise exception 'AUDIT_CONFLICT'; end if;
  if event_row.withdrawn_at is not null then raise exception 'AUDIT_WITHDRAWN'; end if;
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
end $function$;

-- Existing iq_supplier_audit_result: only add the withdrawal guard after the scoped lock/revision check.
CREATE OR REPLACE FUNCTION public.iq_supplier_audit_result(p_event uuid, p_revision integer, p_result jsonb, p_finalize boolean, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_org uuid:=public.iq_supplier_audit_org(); e public.supplier_audit_events%rowtype; previous public.supplier_assessments%rowtype; result_id uuid; expected_count integer; rubric integer; report_id uuid:=nullif(p_result->>'reportId','')::uuid; plan_id uuid:=nullif(p_result->>'planId','')::uuid;
begin
 if not public.iq_supplier_audit_inspector(selected_org) then raise exception using errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; end if;
 select * into e from public.supplier_audit_events where id=p_event and organization_id=selected_org for update;
 if e.id is null or e.supplier_id is null or not public.iq_supplier_audit_supplier_allowed(e.supplier_id,selected_org) then raise exception using errcode='42501',message='AUDIT_ACCESS_DENIED'; end if;
 if e.revision is distinct from p_revision then raise exception 'AUDIT_CONFLICT'; end if;
  if e.withdrawn_at is not null then raise exception 'AUDIT_WITHDRAWN'; end if;
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
end $function$;

-- Capability is advertised only when this entire transaction succeeds.
CREATE OR REPLACE FUNCTION public.iq_supplier_audit_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_org uuid:=public.iq_supplier_audit_org();
begin
 return jsonb_build_object('withdrawalVersion',1,'organizationId',selected_org,'canManage',public.iq_supplier_audit_inspector(selected_org),
 'administrator',exists(select 1 from public.profiles where id=auth.uid() and user_type='administrator'));
end $function$;

-- Existing RPC ownership, grants, RLS and Storage policies remain unchanged.
NOTIFY pgrst, 'reload schema';
COMMIT;
