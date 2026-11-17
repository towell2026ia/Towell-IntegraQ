-- IQ-PROV-AUDITORIAS-MANUALES — PROPOSAL ONLY. NOT EXECUTED.
-- Apply this file alone only after approval of its exact SHA-256 and existing target.
-- No seed, backfill, import, Storage upload, notification or administrative RPC invocation.
-- Existing RNCP, compression, Root2Cause and withdrawal definitions are not replaced.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE name text; rel regclass;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'MANUAL_INSTALL_OWNER_REQUIRED'; END IF;
  FOREACH name IN ARRAY ARRAY['supplier_audit_events','supplier_assessments','profiles','organizations','file_objects','file_upload_policies','audit_log'] LOOP
    rel := to_regclass('public.' || name);
    IF rel IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=rel AND relrowsecurity AND pg_get_userbyid(relowner)='postgres') THEN
      RAISE EXCEPTION 'MANUAL_DEPENDENCY_TABLE_RLS_OWNER: %',name;
    END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['public.iq_supplier_audit_org()','public.iq_supplier_audit_inspector(uuid)',
    'public.iq_supplier_audit_supplier_allowed(uuid,uuid)','public.iq_supplier_audit_log(text,uuid,jsonb,jsonb,text)',
    'public.iq_supplier_audit_can_read(uuid)','public.has_permission(text,uuid,uuid,text,uuid,boolean,uuid)',
    'public.iq_supplier_audit_file(uuid,integer,jsonb)','pg_catalog.sha256(bytea)'] LOOP
    IF to_regprocedure(name) IS NULL THEN RAISE EXCEPTION 'MANUAL_DEPENDENCY_FUNCTION: %',name; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='integraq-private' AND NOT public) THEN RAISE EXCEPTION 'MANUAL_PRIVATE_BUCKET_REQUIRED'; END IF;
  IF (SELECT count(*) FROM public.file_upload_policies WHERE resource_type IN ('supplier_audit_report','supplier_audit_action_plan')
    AND max_size_bytes>0 AND 'application/pdf'=ANY(allowed_mime_types))<>2 THEN RAISE EXCEPTION 'MANUAL_PDF_POLICIES_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_audit_events' AND policyname='supplier_audit_events_read')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='file_objects' AND policyname='supplier_audit_files_private' AND permissive='RESTRICTIVE')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='supplier_audit_storage_private' AND permissive='RESTRICTIVE')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_assessments' AND policyname='supplier_audit_result_scope' AND permissive='RESTRICTIVE')
    OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log' AND policyname='supplier_audit_log_scope' AND permissive='RESTRICTIVE')
  THEN RAISE EXCEPTION 'MANUAL_EXISTING_RLS_REQUIRED'; END IF;
  -- Refuse drift in the existing RLS expressions captured in the local catalog.
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log' AND policyname='supplier_audit_log_insert' AND permissive='RESTRICTIVE' AND cmd='INSERT' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='d41d8cd98f00b204e9800998ecf8427e' AND md5(coalesce(with_check,''))='994b930f246a0deb0e9e7970dce57601') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_log_insert'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log' AND policyname='supplier_audit_log_scope' AND permissive='RESTRICTIVE' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='6c6f49154361e34d603dfaba66ca1912' AND md5(coalesce(with_check,''))='d41d8cd98f00b204e9800998ecf8427e') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_log_scope'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='file_objects' AND policyname='supplier_audit_files_private' AND permissive='RESTRICTIVE' AND cmd='ALL' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='176bc0cb768ed3c77f4cc8a2145a279d' AND md5(coalesce(with_check,''))='176bc0cb768ed3c77f4cc8a2145a279d') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_files_private'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_assessments' AND policyname='supplier_audit_result_scope' AND permissive='RESTRICTIVE' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='16ad0fd9a32beb0fcc0225565823aa8f' AND md5(coalesce(with_check,''))='d41d8cd98f00b204e9800998ecf8427e') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_result_scope'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_audit_events' AND policyname='supplier_audit_events_read' AND permissive='PERMISSIVE' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='9bf2b91bcb2b3d0951d7fdebc9981c25' AND md5(coalesce(with_check,''))='d41d8cd98f00b204e9800998ecf8427e') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_events_read'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='supplier_audit_storage_private' AND permissive='RESTRICTIVE' AND cmd='ALL' AND roles=ARRAY['authenticated']::name[] AND md5(coalesce(qual,''))='9181f1ddf6544d1846514872cdce74ec' AND md5(coalesce(with_check,''))='9181f1ddf6544d1846514872cdce74ec') THEN RAISE EXCEPTION 'MANUAL_RLS_DRIFT: supplier_audit_storage_private'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_org()'))) IS DISTINCT FROM '9536dc2957b8ea4e6b8c1bd1248fb96f' THEN RAISE EXCEPTION 'MANUAL_AUTH_DEPENDENCY_DRIFT: iq_supplier_audit_org'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_inspector(uuid)'))) IS DISTINCT FROM '0cea6eabb4f965790b0259afb36122f2' THEN RAISE EXCEPTION 'MANUAL_AUTH_DEPENDENCY_DRIFT: iq_supplier_audit_inspector'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_supplier_allowed(uuid,uuid)'))) IS DISTINCT FROM '5265eb240ba9a38c9c47588f3269c426' THEN RAISE EXCEPTION 'MANUAL_AUTH_DEPENDENCY_DRIFT: iq_supplier_audit_supplier_allowed'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_can_read(uuid)'))) IS DISTINCT FROM '676fea6665ffb3cddc30fbf16860321f' THEN RAISE EXCEPTION 'MANUAL_AUTH_DEPENDENCY_DRIFT: iq_supplier_audit_can_read'; END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.iq_supplier_audit_log(text,uuid,jsonb,jsonb,text)'))) IS DISTINCT FROM 'd07864f7f1ffcfab7b5c6931834e7d98' THEN RAISE EXCEPTION 'MANUAL_AUTH_DEPENDENCY_DRIFT: iq_supplier_audit_log'; END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.supplier_audit_events'::regclass AND attname IN ('manual_record','manual_classification') AND NOT attisdropped)
    OR to_regprocedure('public.iq_supplier_audit_manual_read(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'MANUAL_ALREADY_INSTALLED_REVIEW_REQUIRED';
  END IF;
END;
$preflight$;

ALTER TABLE public.supplier_audit_events
  ADD COLUMN manual_record jsonb,
  -- This extracts the explicit human selection; it never infers a supplier type.
  ADD COLUMN manual_classification text GENERATED ALWAYS AS (manual_record #>> '{record,classification}') STORED,
  ADD CONSTRAINT supplier_audit_manual_classification_check CHECK (manual_classification IS NULL OR manual_classification IN ('manufacturer','distributor','service')),
  ADD CONSTRAINT supplier_audit_manual_envelope_check CHECK (manual_record IS NULL OR (jsonb_typeof(manual_record)='object' AND jsonb_typeof(manual_record->'record')='object' AND jsonb_typeof(manual_record->'receipt')='object'));
COMMENT ON COLUMN public.supplier_audit_events.manual_record IS 'Human-entered audit record, publication binding and last request receipt. History in audit_log. No conversion of V1/V2.';
COMMENT ON COLUMN public.supplier_audit_events.manual_classification IS 'Explicit Calidad selection: manufacturer/distributor/service. Original criteria/source_payload remain unchanged.';

-- All helpers are private by privilege, despite sharing the existing public schema.
CREATE FUNCTION public.iq_supplier_audit_manual_uuid(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $sql$
  SELECT coalesce(jsonb_typeof(v)='string' AND v#>>'{}' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false)
$sql$;
CREATE FUNCTION public.iq_supplier_audit_manual_date(v jsonb,p_optional boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $date$
DECLARE d date; s text;
BEGIN
  IF v='null'::jsonb AND p_optional THEN RETURN true; END IF;
  IF jsonb_typeof(v) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  s:=v#>>'{}'; IF s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
  BEGIN d:=s::date; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false; END;
  RETURN to_char(d,'YYYY-MM-DD')=s AND d BETWEEN DATE '2000-01-01' AND DATE '2200-12-31';
END;
$date$;
CREATE FUNCTION public.iq_supplier_audit_manual_ids(v jsonb,p_limit integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $ids$
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  RETURN jsonb_array_length(v)<=p_limit
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE NOT public.iq_supplier_audit_manual_uuid(x))
    AND (SELECT count(*)=count(DISTINCT lower(x#>>'{}')) FROM jsonb_array_elements(v) x);
END;
$ids$;
CREATE FUNCTION public.iq_supplier_audit_manual_validate(r jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $validate$
DECLARE a jsonb; s jsonb; k text;
BEGIN
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR octet_length(r::text)>1048576 THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  IF NOT (r ?& ARRAY['classification','discrepancy','methodology','auditDate','evaluatorName','score','actions','approvedFileIds','portalVisible'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) x WHERE x<>ALL(ARRAY['classification','discrepancy','methodology','auditDate','evaluatorName','score','actions','approvedFileIds','portalVisible'])) THEN RAISE EXCEPTION 'MANUAL_INPUT_KEYS'; END IF;
  IF r->'classification'<>'null'::jsonb AND (jsonb_typeof(r->'classification')<>'string' OR r->>'classification' NOT IN ('manufacturer','distributor','service')) THEN RAISE EXCEPTION 'MANUAL_CLASSIFICATION'; END IF;
  IF r->'methodology'<>'null'::jsonb AND (jsonb_typeof(r->'methodology')<>'string' OR r->>'methodology' NOT IN ('V1','V2','other')) THEN RAISE EXCEPTION 'MANUAL_METHODOLOGY'; END IF;
  IF jsonb_typeof(r->'portalVisible')<>'boolean' OR NOT public.iq_supplier_audit_manual_date(r->'auditDate',true)
    OR NOT public.iq_supplier_audit_manual_ids(r->'approvedFileIds',100) THEN RAISE EXCEPTION 'MANUAL_INPUT_INVALID'; END IF;
  FOREACH k IN ARRAY ARRAY['discrepancy','evaluatorName'] LOOP
    IF jsonb_typeof(r->k)<>'string' OR char_length(r->>k)>(CASE WHEN k='discrepancy' THEN 2000 ELSE 300 END) THEN RAISE EXCEPTION 'MANUAL_TEXT_INVALID'; END IF;
  END LOOP;
  IF (r->>'portalVisible')::boolean AND r->'classification'='null'::jsonb THEN RAISE EXCEPTION 'MANUAL_CLASSIFICATION_REQUIRED'; END IF;
  s:=r->'score';
  IF s<>'null'::jsonb THEN
    IF jsonb_typeof(s)<>'object' THEN RAISE EXCEPTION 'MANUAL_SCORE_INVALID'; END IF;
    IF NOT (s ?& ARRAY['value','sourceFileId','reference','verified']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(s) x WHERE x<>ALL(ARRAY['value','sourceFileId','reference','verified'])) THEN RAISE EXCEPTION 'MANUAL_SCORE_INVALID'; END IF;
    IF jsonb_typeof(s->'value')<>'number' OR s->'verified'<>'true'::jsonb OR NOT public.iq_supplier_audit_manual_uuid(s->'sourceFileId')
      OR jsonb_typeof(s->'reference')<>'string' OR char_length(btrim(s->>'reference')) NOT BETWEEN 1 AND 1000 OR r->'methodology'='null'::jsonb THEN RAISE EXCEPTION 'MANUAL_SCORE_INVALID'; END IF;
    IF (s->>'value')::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'MANUAL_SCORE_INVALID'; END IF;
    IF (r->>'portalVisible')::boolean AND NOT (r->'approvedFileIds' @> jsonb_build_array(s->>'sourceFileId')) THEN RAISE EXCEPTION 'MANUAL_SCORE_SOURCE_NOT_APPROVED'; END IF;
  END IF;
  IF jsonb_typeof(r->'actions')<>'array' THEN RAISE EXCEPTION 'MANUAL_ACTIONS_INVALID'; END IF;
  IF jsonb_array_length(r->'actions')>100 THEN RAISE EXCEPTION 'MANUAL_ACTIONS_LIMIT'; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(r->'actions') LOOP
    IF jsonb_typeof(a)<>'object' THEN RAISE EXCEPTION 'MANUAL_ACTION_INVALID'; END IF;
    IF NOT (a ?& ARRAY['id','description','responsibleName','commitmentDate','status','completedDate','evidenceFileIds'])
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(a) x WHERE x<>ALL(ARRAY['id','description','responsibleName','commitmentDate','status','completedDate','evidenceFileIds'])) THEN RAISE EXCEPTION 'MANUAL_ACTION_INVALID'; END IF;
    IF NOT public.iq_supplier_audit_manual_uuid(a->'id') OR NOT public.iq_supplier_audit_manual_date(a->'commitmentDate',false)
      OR NOT public.iq_supplier_audit_manual_date(a->'completedDate',true) OR NOT public.iq_supplier_audit_manual_ids(a->'evidenceFileIds',30)
      OR jsonb_typeof(a->'status')<>'string' OR a->>'status' NOT IN ('pending','in_progress','closed') THEN RAISE EXCEPTION 'MANUAL_ACTION_INVALID'; END IF;
    FOREACH k IN ARRAY ARRAY['description','responsibleName'] LOOP
      IF jsonb_typeof(a->k)<>'string' OR char_length(btrim(a->>k)) NOT BETWEEN 1 AND (CASE WHEN k='description' THEN 5000 ELSE 300 END) THEN RAISE EXCEPTION 'MANUAL_ACTION_TEXT'; END IF;
    END LOOP;
    IF a->>'status'<>'closed' AND a->'completedDate'<>'null'::jsonb THEN RAISE EXCEPTION 'MANUAL_ACTION_CLOSURE'; END IF;
    IF (r->>'portalVisible')::boolean AND NOT (r->'approvedFileIds' @> a->'evidenceFileIds') THEN RAISE EXCEPTION 'MANUAL_ACTION_EVIDENCE_NOT_APPROVED'; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT lower(value->>'id')) FROM jsonb_array_elements(r->'actions')) THEN RAISE EXCEPTION 'MANUAL_ACTION_DUPLICATE'; END IF;
END;
$validate$;

CREATE FUNCTION public.iq_supplier_audit_manual_empty(p_date date) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $sql$
 SELECT jsonb_build_object('classification',null,'discrepancy','','methodology',null,'auditDate',p_date,'evaluatorName','','score',null,'actions','[]'::jsonb,'approvedFileIds','[]'::jsonb,'portalVisible',false)
$sql$;

-- Metadata + physical object check. Content/bytes are validated by the existing backend upload.
CREATE FUNCTION public.iq_supplier_audit_manual_file_valid(p_event uuid,p_file uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $sql$
 SELECT EXISTS(SELECT 1 FROM public.supplier_audit_events e
   JOIN public.file_objects f ON f.resource_id=e.id AND f.id=p_file AND f.workspace_id=e.organization_id
   JOIN storage.objects o ON o.bucket_id=f.bucket_id AND o.name=f.object_path
   WHERE e.id=p_event AND e.supplier_id IS NOT NULL AND f.external_organization_id=e.supplier_id
     AND f.resource_type IN ('supplier_audit_report','supplier_audit_action_plan') AND f.module_id='suppliers'
     AND f.audience='internal' AND f.bucket_id='integraq-private' AND f.deleted_at IS NULL AND f.external_site_id IS NULL
     AND f.mime_type='application/pdf' AND f.size_bytes BETWEEN 1 AND 4194304 AND f.sha256 ~ '^[a-f0-9]{64}$'
     AND f.uploaded_by IS NOT NULL AND f.object_path LIKE f.uploaded_by::text||'/supplier-audits/'||e.id::text||'/%'
     AND o.metadata->>'mimetype'='application/pdf' AND o.metadata->>'size'=f.size_bytes::text)
$sql$;

CREATE FUNCTION public.iq_supplier_audit_manual_read(p_event uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $read$
DECLARE org uuid:=public.iq_supplier_audit_org(); e public.supplier_audit_events%rowtype; history jsonb;
BEGIN
 SELECT * INTO e FROM public.supplier_audit_events WHERE id=p_event AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_ACCESS_DENIED'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'at',l.created_at,'actorName',coalesce(l.user_name_snapshot,l.actor_id::text),
   'reason',l.reason,'before',l.previous_value->'record','after',l.new_value->'record') ORDER BY l.created_at,l.id),'[]'::jsonb)
 INTO history FROM public.audit_log l WHERE l.organization_id=org AND l.resource_type='supplier_audit_event'
   AND l.resource_id=e.id::text AND l.action='audit.manual.saved';
 RETURN jsonb_build_object('version',1,'eventId',e.id,'supplierId',e.supplier_id,'revision',e.revision,
   'record',coalesce(e.manual_record->'record',public.iq_supplier_audit_manual_empty(e.actual_date)),'history',history);
END;
$read$;

CREATE FUNCTION public.iq_supplier_audit_manual_save(p_event uuid,p_expected_revision integer,p_request_id uuid,p_record jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $save$
DECLARE org uuid:=public.iq_supplier_audit_org(); actor uuid:=auth.uid(); e public.supplier_audit_events%rowtype;
 previous jsonb; receipt jsonb; envelope jsonb; fingerprint text; fid uuid; assessment public.supplier_assessments%rowtype;
 reason text:=btrim(p_reason); saved_revision integer; old_guard text;
BEGIN
 -- Fresh identity and edit permission BEFORE the organization-scoped row lock.
 IF NOT public.iq_supplier_audit_inspector(org) THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; END IF;
 IF p_event IS NULL OR p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 2147483646
   OR reason IS NULL OR char_length(reason) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'MANUAL_COMMAND_INVALID'; END IF;
 PERFORM public.iq_supplier_audit_manual_validate(p_record);
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('record',p_record,'reason',reason,'revision',p_expected_revision)::text,'UTF8')),'hex');
 SELECT * INTO e FROM public.supplier_audit_events WHERE id=p_event AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_ACCESS_DENIED'; END IF;
 IF to_jsonb(e)->>'withdrawn_at' IS NOT NULL THEN RAISE EXCEPTION 'AUDIT_WITHDRAWN'; END IF;
 IF e.state='cancelled' THEN RAISE EXCEPTION 'AUDIT_CANCELLED'; END IF;
 receipt:=e.manual_record->'receipt';
 IF receipt->>'requestId'=p_request_id::text THEN
   IF receipt->>'actorId' IS DISTINCT FROM actor::text OR receipt->>'fingerprint' IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'MANUAL_REQUEST_REUSED'; END IF;
   IF e.revision IS DISTINCT FROM (receipt->>'revision')::integer THEN RAISE EXCEPTION 'MANUAL_REPLAY_STALE'; END IF;
   RETURN jsonb_build_object('eventId',e.id,'revision',e.revision,'requestId',p_request_id);
 END IF;
 IF EXISTS(SELECT 1 FROM public.audit_log l WHERE l.organization_id=org AND l.resource_type='supplier_audit_event' AND l.resource_id=e.id::text
   AND l.action='audit.manual.saved' AND l.new_value#>>'{receipt,requestId}'=p_request_id::text) THEN RAISE EXCEPTION 'MANUAL_REPLAY_STALE'; END IF;
 IF e.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'MANUAL_CONFLICT'; END IF;
 IF e.supplier_id IS NOT NULL AND (NOT public.iq_supplier_audit_supplier_allowed(e.supplier_id,org)
   OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=e.supplier_id AND active AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'AUDIT_SUPPLIER_SCOPE_UNVERIFIED'; END IF;
 IF (p_record->>'portalVisible')::boolean AND e.supplier_id IS NULL THEN RAISE EXCEPTION 'MANUAL_SUPPLIER_UNVERIFIED'; END IF;
 IF e.source_sha256 IS NOT NULL AND e.actual_date IS NOT NULL AND (p_record->>'auditDate')::date IS DISTINCT FROM e.actual_date THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_DATE'; END IF;
 IF (p_record->>'auditDate')::date>current_date OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_record->'actions') a WHERE (a->>'completedDate')::date>current_date) THEN RAISE EXCEPTION 'MANUAL_ACTUAL_DATE_FUTURE'; END IF;
 previous:=coalesce(e.manual_record->'record',public.iq_supplier_audit_manual_empty(e.actual_date));
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(previous->'actions') a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_record->'actions') b WHERE (a->>'id')::uuid=(b->>'id')::uuid)) THEN RAISE EXCEPTION 'MANUAL_ACTION_PRESERVATION'; END IF;
 IF previous->'score'<>'null'::jsonb AND (previous->'score' IS DISTINCT FROM p_record->'score' OR previous->'methodology' IS DISTINCT FROM p_record->'methodology') THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_SCORE'; END IF;
 SELECT * INTO assessment FROM public.supplier_assessments WHERE audit_event_id=e.id;
 IF FOUND AND p_record->'score'<>'null'::jsonb THEN RAISE EXCEPTION 'MANUAL_EXISTING_ASSESSMENT'; END IF;
 IF assessment.id IS NOT NULL AND (p_record->>'auditDate')::date IS DISTINCT FROM e.actual_date THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_DATE'; END IF;
 IF assessment.id IS NOT NULL AND previous->'methodology'<>'null'::jsonb AND previous->'methodology' IS DISTINCT FROM p_record->'methodology' THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_METHOD'; END IF;
 -- Lock metadata in deterministic order; the owning event serializes legacy uploads.
 FOR fid IN SELECT DISTINCT value::uuid FROM (
   SELECT jsonb_array_elements_text(p_record->'approvedFileIds') AS value
   UNION ALL SELECT jsonb_array_elements_text(a->'evidenceFileIds') FROM jsonb_array_elements(p_record->'actions') a
   UNION ALL SELECT p_record#>>'{score,sourceFileId}' WHERE p_record->'score'<>'null'::jsonb
 ) refs ORDER BY value::uuid LOOP
   PERFORM 1 FROM public.file_objects WHERE id=fid AND workspace_id=org AND resource_id=e.id FOR SHARE;
   IF NOT FOUND OR NOT public.iq_supplier_audit_manual_file_valid(e.id,fid) THEN RAISE EXCEPTION 'MANUAL_DOCUMENT_SCOPE'; END IF;
 END LOOP;
 IF p_record->'score'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM public.file_objects WHERE id=(p_record#>>'{score,sourceFileId}')::uuid AND resource_type='supplier_audit_report') THEN RAISE EXCEPTION 'MANUAL_SCORE_SOURCE'; END IF;
 receipt:=jsonb_build_object('requestId',p_request_id,'actorId',actor,'baseRevision',p_expected_revision,'revision',e.revision+1,'fingerprint',fingerprint,'at',clock_timestamp());
 envelope:=jsonb_build_object('record',p_record,'publicationSupplierId',CASE WHEN (p_record->>'portalVisible')::boolean THEN e.supplier_id ELSE NULL END,'receipt',receipt);
 old_guard:=current_setting('integraq.audit_manual_event',true);
 PERFORM set_config('integraq.audit_manual_event',e.id::text,true);
 UPDATE public.supplier_audit_events SET manual_record=envelope,actual_date=(p_record->>'auditDate')::date,
   revision=revision+1,updated_at=now(),updated_by=actor WHERE id=e.id AND organization_id=org RETURNING revision INTO saved_revision;
 PERFORM public.iq_supplier_audit_log('audit.manual.saved',e.id,jsonb_build_object('record',previous,'revision',e.revision),
   jsonb_build_object('record',p_record,'receipt',receipt,'revision',saved_revision,'publicationSupplierId',envelope->'publicationSupplierId'),reason);
 IF NOT EXISTS(SELECT 1 FROM public.audit_log l WHERE l.organization_id=org AND l.actor_id=actor AND l.resource_type='supplier_audit_event'
   AND l.resource_id=e.id::text AND l.action='audit.manual.saved' AND l.reason=reason AND l.previous_value->'record'=previous
   AND l.new_value->'record'=p_record AND l.new_value->'receipt'=receipt) THEN RAISE EXCEPTION 'MANUAL_AUDIT_REQUIRED'; END IF;
 PERFORM set_config('integraq.audit_manual_event',coalesce(old_guard,''),true);
 RETURN jsonb_build_object('eventId',e.id,'revision',saved_revision,'requestId',p_request_id);
END;
$save$;

-- No external permission comes from JWT user_metadata, supplied IDs or browser claims.
CREATE FUNCTION public.iq_supplier_audit_manual_portal_scope(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $sql$
 SELECT EXISTS(SELECT 1 FROM public.supplier_audit_events e
  JOIN public.profiles p ON p.id=auth.uid() AND p.status='active' AND p.user_type='supplier' AND p.workspace_mode='production'
    AND p.external_party_kind='supplier' AND p.external_party_id=e.supplier_id
  JOIN public.organizations s ON s.id=e.supplier_id AND s.kind='supplier' AND s.active AND s.deleted_at IS NULL
  JOIN public.organizations tenant ON tenant.id=e.organization_id AND tenant.kind='internal' AND tenant.active AND tenant.deleted_at IS NULL
  WHERE e.id=p_event AND to_jsonb(e)->>'withdrawn_at' IS NULL AND e.state<>'cancelled'
    AND e.manual_record#>>'{record,portalVisible}'='true' AND e.manual_classification IS NOT NULL
    AND e.manual_record->>'publicationSupplierId'=e.supplier_id::text
    AND (s.owning_organization_id=e.organization_id OR (s.owning_organization_id IS NULL AND (SELECT count(*) FROM public.organizations WHERE kind='internal')=1))
    -- Calendar events have no branch/site identity. Site-scoped accounts fail closed.
    AND p.external_site_id IS NULL
    AND public.has_permission('portal_proveedores.acceder',NULL,NULL,NULL,NULL,false,e.supplier_id))
$sql$;
CREATE FUNCTION public.iq_supplier_audit_manual_portal_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $actor$
DECLARE supplier uuid;
BEGIN
 SELECT p.external_party_id INTO supplier FROM public.profiles p JOIN public.organizations s ON s.id=p.external_party_id
 WHERE p.id=auth.uid() AND p.status='active' AND p.user_type='supplier' AND p.workspace_mode='production'
  AND p.external_party_kind='supplier' AND p.external_site_id IS NULL AND s.kind='supplier' AND s.active AND s.deleted_at IS NULL
  AND public.has_permission('portal_proveedores.acceder',NULL,NULL,NULL,NULL,false,s.id);
 IF supplier IS NULL THEN RAISE EXCEPTION USING errcode='42501',message='MANUAL_PORTAL_ACCESS_DENIED'; END IF;
 RETURN supplier;
END;
$actor$;
CREATE FUNCTION public.iq_supplier_audit_portal_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $list$
DECLARE supplier uuid:=public.iq_supplier_audit_manual_portal_actor(); e public.supplier_audit_events%rowtype;
 r jsonb; files jsonb; actions jsonb; score numeric; source_id uuid; assessment public.supplier_assessments%rowtype; items jsonb:='[]'::jsonb;
BEGIN
 FOR e IN SELECT * FROM public.supplier_audit_events WHERE supplier_id=supplier AND public.iq_supplier_audit_manual_portal_scope(id) ORDER BY actual_date DESC NULLS LAST,id LOOP
  r:=e.manual_record->'record';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'resource_id',e.id,'resource_type',f.resource_type,'original_name',f.original_name,
    'version',f.version,'is_current',f.is_current,'created_at',f.created_at,'size_bytes',f.size_bytes) ORDER BY f.created_at,f.id),'[]'::jsonb)
  INTO files FROM public.file_objects f WHERE f.resource_id=e.id AND f.workspace_id=e.organization_id
    AND r->'approvedFileIds' @> jsonb_build_array(f.id::text) AND public.iq_supplier_audit_manual_file_valid(e.id,f.id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a->'id','description',a->'description','responsibleName',a->'responsibleName',
    'commitmentDate',a->'commitmentDate','status',a->'status','completedDate',a->'completedDate','evidenceFileIds',
    (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(a->'evidenceFileIds') x WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(files) f WHERE f->'id'=x))) ORDER BY ord),'[]'::jsonb)
  INTO actions FROM jsonb_array_elements(r->'actions') WITH ORDINALITY a_rows(a,ord);
  score:=NULL; source_id:=NULL;
  IF r->'score'<>'null'::jsonb THEN score:=(r#>>'{score,value}')::numeric; source_id:=(r#>>'{score,sourceFileId}')::uuid;
  ELSE
    SELECT * INTO assessment FROM public.supplier_assessments WHERE audit_event_id=e.id AND supplier_id=supplier AND site_id IS NULL;
    IF FOUND THEN score:=assessment.score; source_id:=assessment.audit_report_file_id; END IF;
  END IF;
  IF source_id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(files) f WHERE f->>'id'=source_id::text AND f->>'resource_type'='supplier_audit_report') THEN score:=NULL; END IF;
  items:=items||jsonb_build_array(jsonb_build_object('eventId',e.id,'supplierId',supplier,'auditDate',e.actual_date,
    'classification',e.manual_classification,'methodology',r->'methodology','score',score,'actions',actions,'files',files));
 END LOOP;
 RETURN jsonb_build_object('version',1,'audits',items);
END;
$list$;
CREATE FUNCTION public.iq_supplier_audit_portal_file(p_event uuid,p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $file$
DECLARE supplier uuid:=public.iq_supplier_audit_manual_portal_actor(); e public.supplier_audit_events%rowtype; f public.file_objects%rowtype;
BEGIN
 SELECT * INTO e FROM public.supplier_audit_events WHERE id=p_event AND supplier_id=supplier AND public.iq_supplier_audit_manual_portal_scope(id);
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='MANUAL_PORTAL_DOCUMENT_DENIED'; END IF;
 IF NOT (e.manual_record#>'{record,approvedFileIds}' @> jsonb_build_array(p_file::text)) OR NOT public.iq_supplier_audit_manual_file_valid(e.id,p_file) THEN RAISE EXCEPTION USING errcode='42501',message='MANUAL_PORTAL_DOCUMENT_DENIED'; END IF;
 SELECT * INTO f FROM public.file_objects WHERE id=p_file AND resource_id=e.id AND workspace_id=e.organization_id AND external_organization_id=supplier;
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='MANUAL_PORTAL_DOCUMENT_DENIED'; END IF;
 RETURN jsonb_build_object('eventId',e.id,'id',f.id,'supplierId',supplier,'organizationId',e.organization_id,'bucket',f.bucket_id,'path',f.object_path,'name',f.original_name,'authorized',true);
END;
$file$;

-- Additive guards only. No replacement of approved calendar/withdrawal functions.
CREATE FUNCTION public.iq_supplier_audit_manual_event_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.manual_record IS NOT NULL THEN RAISE EXCEPTION 'MANUAL_USE_RPC'; END IF;
 ELSIF TG_OP='DELETE' THEN
  IF OLD.manual_record IS NOT NULL THEN RAISE EXCEPTION 'MANUAL_PHYSICAL_DELETE_DENIED'; END IF;
  RETURN OLD;
 ELSE
  IF NEW.manual_record IS DISTINCT FROM OLD.manual_record THEN
   IF current_user<>'postgres' OR current_setting('integraq.audit_manual_event',true) IS DISTINCT FROM NEW.id::text
     OR NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN RAISE EXCEPTION 'MANUAL_USE_RPC'; END IF;
  ELSIF OLD.manual_record IS NOT NULL AND NEW.actual_date IS DISTINCT FROM OLD.actual_date THEN RAISE EXCEPTION 'MANUAL_DATE_USE_CAPTURE'; END IF;
  IF OLD.manual_record IS NOT NULL AND (NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id
    OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256 OR NEW.source_payload IS DISTINCT FROM OLD.source_payload
    OR NEW.historical_supplier_name IS DISTINCT FROM OLD.historical_supplier_name OR NEW.source_sheet IS DISTINCT FROM OLD.source_sheet
    OR NEW.source_row IS DISTINCT FROM OLD.source_row OR NEW.source_column IS DISTINCT FROM OLD.source_column OR NEW.source_status IS DISTINCT FROM OLD.source_status) THEN RAISE EXCEPTION 'MANUAL_SOURCE_IMMUTABLE'; END IF;
 END IF;
 RETURN NEW;
END;
$guard$;
CREATE TRIGGER supplier_audit_manual_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_audit_events FOR EACH ROW EXECUTE FUNCTION public.iq_supplier_audit_manual_event_guard();
CREATE FUNCTION public.iq_supplier_audit_manual_assessment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $guard$
DECLARE e public.supplier_audit_events%rowtype; eid uuid; org uuid;
BEGIN
 eid:=CASE WHEN TG_OP='INSERT' THEN NEW.audit_event_id ELSE OLD.audit_event_id END;
 IF eid IS NOT NULL THEN
  org:=public.iq_supplier_audit_org();
  IF NOT public.iq_supplier_audit_inspector(org) THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; END IF;
  SELECT * INTO e FROM public.supplier_audit_events WHERE id=eid AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_ACCESS_DENIED'; END IF;
  IF e.manual_record IS NOT NULL AND (TG_OP<>'INSERT' OR e.manual_record#>'{record,score}'<>'null'::jsonb OR e.manual_record#>>'{record,methodology}'='V1') THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_ASSESSMENT'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.audit_event_id IS DISTINCT FROM OLD.audit_event_id AND NEW.audit_event_id IS NOT NULL THEN
  org:=public.iq_supplier_audit_org();
  IF NOT public.iq_supplier_audit_inspector(org) THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_INSPECTOR_REQUIRED'; END IF;
  SELECT * INTO e FROM public.supplier_audit_events WHERE id=NEW.audit_event_id AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='AUDIT_ACCESS_DENIED'; END IF;
  IF e.manual_record IS NOT NULL THEN RAISE EXCEPTION 'MANUAL_HISTORICAL_ASSESSMENT'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$guard$;
CREATE TRIGGER supplier_audit_manual_assessment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_assessments FOR EACH ROW EXECUTE FUNCTION public.iq_supplier_audit_manual_assessment_guard();
CREATE FUNCTION public.iq_supplier_audit_manual_log_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.action='audit.manual.saved' AND OLD.resource_type='supplier_audit_event' THEN RAISE EXCEPTION 'MANUAL_LOG_IMMUTABLE'; END IF;
 IF TG_OP<>'DELETE' AND NEW.action='audit.manual.saved' THEN
  IF TG_OP<>'INSERT' OR NEW.resource_type<>'supplier_audit_event' OR current_user<>'postgres'
    OR current_setting('integraq.audit_manual_event',true) IS DISTINCT FROM NEW.resource_id THEN RAISE EXCEPTION 'MANUAL_LOG_USE_RPC'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$guard$;
CREATE TRIGGER supplier_audit_manual_log_guard BEFORE INSERT OR UPDATE OR DELETE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.iq_supplier_audit_manual_log_guard();

CREATE UNIQUE INDEX supplier_audit_manual_request_unique ON public.audit_log(organization_id,resource_id,(new_value#>>'{receipt,requestId}'))
 WHERE resource_type='supplier_audit_event' AND action='audit.manual.saved';

-- Existing RLS remains in force. No new portal table policy and no Storage policy relaxation.
-- Default Supabase function ACLs may grant service_role too: revoke explicitly.
DO $privileges$
DECLARE sig text;
BEGIN
 FOREACH sig IN ARRAY ARRAY[
  'public.iq_supplier_audit_manual_uuid(jsonb)','public.iq_supplier_audit_manual_date(jsonb,boolean)',
  'public.iq_supplier_audit_manual_ids(jsonb,integer)','public.iq_supplier_audit_manual_validate(jsonb)',
  'public.iq_supplier_audit_manual_empty(date)','public.iq_supplier_audit_manual_file_valid(uuid,uuid)',
  'public.iq_supplier_audit_manual_read(uuid)','public.iq_supplier_audit_manual_save(uuid,integer,uuid,jsonb,text)',
  'public.iq_supplier_audit_manual_portal_scope(uuid)','public.iq_supplier_audit_manual_portal_actor()',
  'public.iq_supplier_audit_portal_list()','public.iq_supplier_audit_portal_file(uuid,uuid)',
  'public.iq_supplier_audit_manual_event_guard()','public.iq_supplier_audit_manual_assessment_guard()','public.iq_supplier_audit_manual_log_guard()'] LOOP
  EXECUTE 'ALTER FUNCTION '||sig||' OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION '||sig||' FROM PUBLIC, anon, authenticated, service_role';
 END LOOP;
END;
$privileges$;
GRANT EXECUTE ON FUNCTION public.iq_supplier_audit_manual_read(uuid),public.iq_supplier_audit_manual_save(uuid,integer,uuid,jsonb,text),
 public.iq_supplier_audit_portal_list(),public.iq_supplier_audit_portal_file(uuid,uuid) TO authenticated;
COMMIT;
