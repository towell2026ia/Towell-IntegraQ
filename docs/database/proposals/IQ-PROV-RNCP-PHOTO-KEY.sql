-- PROPOSAL ONLY. Apply AFTER protected V2, BEFORE using photos. No existing image changes.
-- Preserve file_objects_one_current_resource_uidx; stable per-photo key based on reserved file_id.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$
DECLARE t text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'PHOTO_KEY_OWNER_REQUIRED'; END IF;
 FOREACH t IN ARRAY ARRAY['supplier_rncp_initial_photo_sets','supplier_rncp_initial_photo_reservations','supplier_rncp_photo_draft_requests'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'PHOTO_KEY_V2_REQUIRED'; END IF;
 END LOOP;
 IF md5((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.iq_rncp_initial_photo_stage(uuid,jsonb)'))) IS DISTINCT FROM 'b4b19244589fafd07978483248a074a8'
  OR md5((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.iq_rncp_initial_photo_file_guard()'))) IS DISTINCT FROM 'd7610fe3c6ad2f922570bf85a884d003'
 THEN RAISE EXCEPTION 'PHOTO_KEY_V2_FUNCTION_DRIFT'; END IF;
 IF md5(pg_get_indexdef(to_regclass('public.file_objects_one_current_resource_uidx'))) IS DISTINCT FROM '69b8f6acfd9971d405d24c32e7f82aba' THEN RAISE EXCEPTION 'PHOTO_KEY_INDEX_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM public.file_objects WHERE resource_type='supplier_rncp_initial_photo'
   OR (bucket_id='integraq-private' AND (object_path LIKE 'rncp-initial/%' OR preview_path LIKE 'rncp-initial/%')))
  OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='integraq-private' AND name LIKE 'rncp-initial/%')
  OR EXISTS(SELECT 1 FROM public.supplier_rncp_initial_photo_reservations)
  OR EXISTS(SELECT 1 FROM public.supplier_rncp_initial_photo_sets)
 THEN RAISE EXCEPTION 'PHOTO_KEY_EXISTING_DATA_REVIEW_NO_BACKFILL'; END IF;
END;
$preflight$;
CREATE OR REPLACE FUNCTION public.iq_rncp_initial_photo_stage(p_report uuid,p_file jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare org uuid; r public.supplier_rncp_reports%rowtype; existing public.file_objects%rowtype; file_id uuid:=(p_file->>'id')::uuid; expected_path text; reservation public.supplier_rncp_initial_photo_reservations%rowtype;
begin
 -- Same report lock as registration: photos cannot be attached after submit.
 org:=public.iq_rncp_initial_photo_guard(p_report,true);
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org
  and source_kind='native' and deleted_at is null and status='draft' and notified_at is null for update;
 if not found then raise exception 'PHOTO_DRAFT_LOCKED'; end if;
 select a.* into reservation from public.supplier_rncp_initial_photo_reservations a where a.file_id=iq_rncp_initial_photo_stage.file_id;
 if reservation.file_id is null or reservation.organization_id is distinct from org
  or reservation.report_id is distinct from p_report or reservation.actor_id is distinct from auth.uid()
  or reservation.file_data is distinct from p_file or reservation.verified_at is null then
  raise exception using errcode='42501',message='PHOTO_BACKEND_VERIFICATION_REQUIRED';
 end if;
 if coalesce(p_file->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_file->>'mime','') not in ('image/jpeg','image/png','image/webp')
  or not (coalesce((p_file->>'size')::bigint,0) between 1 and 4194304) or coalesce(length(trim(p_file->>'name')),0) not between 1 and 180
  or not (coalesce((p_file->>'width')::integer,0) between 1 and 8192) or not (coalesce((p_file->>'height')::integer,0) between 1 and 8192)
  or (p_file->>'width')::bigint*(p_file->>'height')::bigint>25000000 then raise exception 'PHOTO_INVALID'; end if;
 expected_path:='rncp-initial/'||org::text||'/'||p_report::text||'/'||(p_file->>'sha256')||
  case p_file->>'mime' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.jpg' end;
 if p_file->>'path' is distinct from expected_path or not exists(select 1 from storage.objects where bucket_id='integraq-private' and name=expected_path
  and (metadata->>'size')::bigint=(p_file->>'size')::bigint and metadata->>'mimetype'=p_file->>'mime') then raise exception 'PHOTO_OBJECT_UNVERIFIED'; end if;
 select * into existing from public.file_objects where object_path=expected_path;
 if existing.id is not null then
  if existing.resource_type<>'supplier_rncp_initial_photo' or existing.workspace_id<>org or existing.resource_id<>p_report or existing.sha256<>p_file->>'sha256' or existing.deleted_at is not null
   or existing.resource_key is distinct from 'initial-photo:'||file_id::text
   or existing.category is not null or existing.version is distinct from 1 or existing.is_current is distinct from true
   or existing.id is distinct from file_id or existing.bucket_id is distinct from 'integraq-private'
   or existing.original_name is distinct from p_file->>'name' or existing.mime_type is distinct from p_file->>'mime'
   or existing.size_bytes is distinct from (p_file->>'size')::bigint
   or existing.observations::jsonb is distinct from jsonb_build_object('width',(p_file->>'width')::integer,'height',(p_file->>'height')::integer)
   then raise exception 'PHOTO_IDENTITY_CONFLICT'; end if;
  return existing.id;
 end if;
 insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,audience,resource_type,resource_id,
  resource_key,workspace_id,version,is_current,uploaded_by,preview_status,observations,external_organization_id)
 values(file_id,'integraq-private',expected_path,p_file->>'name',p_file->>'mime',(p_file->>'size')::bigint,p_file->>'sha256','suppliers','internal',
  'supplier_rncp_initial_photo',p_report,'initial-photo:'||file_id::text,org,1,true,auth.uid(),'not_required',
  jsonb_build_object('width',(p_file->>'width')::integer,'height',(p_file->>'height')::integer)::text,r.supplier_id);
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,entity_code_snapshot,metadata)
 values(auth.uid(),org,'suppliers','rncp.initial_photo.staged','supplier_rncp_report',p_report::text,r.folio,
  jsonb_build_object('file_id',file_id,'sha256',p_file->>'sha256'));
 return file_id;
end $$;
CREATE OR REPLACE FUNCTION public.iq_rncp_initial_photo_file_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare reserved public.supplier_rncp_initial_photo_reservations%rowtype;
begin
 if tg_op in ('UPDATE','DELETE') and (old.resource_type='supplier_rncp_initial_photo'
  or (old.bucket_id='integraq-private' and old.object_path like 'rncp-initial/%')) then
  raise exception 'PHOTO_FILE_IMMUTABLE_USE_MANIFEST';
 end if;
 if tg_op='DELETE' then return old; end if;
 if new.bucket_id='integraq-private' and new.preview_path like 'rncp-initial/%' then
  raise exception 'PHOTO_RESERVED_PREVIEW_PATH';
 end if;
 if new.resource_type<>'supplier_rncp_initial_photo'
  and not (new.bucket_id='integraq-private' and new.object_path like 'rncp-initial/%') then return new; end if;
 if tg_op<>'INSERT' then raise exception 'PHOTO_FILE_IMMUTABLE_USE_MANIFEST'; end if;
 select * into reserved from public.supplier_rncp_initial_photo_reservations where file_id=new.id;
 if not found or reserved.verified_at is null or new.resource_type is distinct from 'supplier_rncp_initial_photo'
  or new.bucket_id is distinct from 'integraq-private' or new.object_path is distinct from reserved.object_path
  or new.workspace_id is distinct from reserved.organization_id or new.resource_id is distinct from reserved.report_id
  or new.resource_key is distinct from 'initial-photo:'||reserved.file_id::text
  or new.category is not null or new.version is distinct from 1 or new.is_current is distinct from true
  or new.uploaded_by is distinct from reserved.actor_id or new.deleted_at is not null
  or new.original_name is distinct from reserved.file_data->>'name' or new.sha256 is distinct from reserved.file_data->>'sha256'
  or new.mime_type is distinct from reserved.file_data->>'mime' or new.size_bytes is distinct from reserved.size_bytes
  or new.audience::text is distinct from 'internal' or new.module_id is distinct from 'suppliers'
  or new.external_organization_id is distinct from (select supplier_id from public.supplier_rncp_reports where id=reserved.report_id)
  or new.observations::jsonb is distinct from jsonb_build_object('width',(reserved.file_data->>'width')::integer,'height',(reserved.file_data->>'height')::integer)
 then raise exception 'PHOTO_VERIFICATION_MISMATCH'; end if;
 return new;
end $$;
ALTER FUNCTION public.iq_rncp_initial_photo_stage(uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.iq_rncp_initial_photo_file_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.iq_rncp_initial_photo_stage(uuid,jsonb),public.iq_rncp_initial_photo_file_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.iq_rncp_initial_photo_stage(uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
