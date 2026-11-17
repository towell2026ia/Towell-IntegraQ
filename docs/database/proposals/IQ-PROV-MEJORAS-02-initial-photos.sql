-- IQ-PROV-MEJORAS-02 V2: proposal ONLY. NOT EXECUTED.
-- Replaces V1 as a fresh proposal, NOT an incremental upgrade of an installed V1.
-- Requires reserve -> private upload -> backend attest -> authenticated stage -> commit.
-- Application 90503c7 is preserved and does NOT yet implement reserve/attest.
-- No retention cleanup; all reservations consume quota permanently until a separate approved policy.
-- No historical RNCP, original PDF, action evidence or notification is updated.
begin;
-- Abort rather than change pre-existing initial-photo records or install over V1.
do $$
begin
 if not exists(select 1 from storage.buckets b where b.id='integraq-private' and b.public=false) then
  raise exception 'PHOTO_PRIVATE_BUCKET_REQUIRED';
 end if;
 if exists(select 1 from public.file_objects where resource_type='supplier_rncp_initial_photo'
   or (bucket_id='integraq-private' and (object_path like 'rncp-initial/%' or preview_path like 'rncp-initial/%')))
  or exists(select 1 from storage.objects where bucket_id='integraq-private' and name like 'rncp-initial/%') then
  raise exception 'PHOTO_NAMESPACE_NOT_EMPTY_REVIEW_REQUIRED';
 end if;
end $$;
create table public.supplier_rncp_initial_photo_sets (
 report_id uuid primary key references public.supplier_rncp_reports(id) on delete restrict,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 file_ids uuid[] not null default '{}', revision integer not null check(revision>0),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
 check(cardinality(file_ids)<=12)
);
create table public.supplier_rncp_photo_draft_requests (
 organization_id uuid not null references public.organizations(id), actor_id uuid not null references public.profiles(id),
 request_key uuid not null, request_payload jsonb not null, report_id uuid not null references public.supplier_rncp_reports(id) on delete restrict,
 primary key(organization_id,actor_id,request_key)
);
create table public.supplier_rncp_initial_photo_reservations (
 file_id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete restrict,
 report_id uuid not null references public.supplier_rncp_reports(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 object_path text not null unique,
 size_bytes bigint not null check(size_bytes between 1 and 4194304),
 file_data jsonb not null check(jsonb_typeof(file_data)='object'),
 created_at timestamptz not null default now(),
 verified_at timestamptz,
 unique(organization_id,report_id,file_id)
);
create index rncp_initial_reservation_org_report on public.supplier_rncp_initial_photo_reservations(organization_id,report_id);
alter table public.supplier_rncp_initial_photo_reservations enable row level security;
revoke all on public.supplier_rncp_initial_photo_reservations from public,anon,authenticated,service_role;
alter table public.supplier_rncp_initial_photo_sets enable row level security;
alter table public.supplier_rncp_photo_draft_requests enable row level security;
revoke all on public.supplier_rncp_initial_photo_sets,public.supplier_rncp_photo_draft_requests from public,anon,authenticated;
-- No direct table writes for API roles, including service_role; only guarded RPCs.
revoke all on public.supplier_rncp_initial_photo_sets,public.supplier_rncp_photo_draft_requests from service_role;
-- These records and objects are only served through the guarded backend/RPC.
create policy rncp_initial_photo_files_private on public.file_objects as restrictive for all to authenticated
 using(resource_type<>'supplier_rncp_initial_photo') with check(resource_type<>'supplier_rncp_initial_photo');
create policy rncp_initial_photo_objects_private on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'integraq-private' or name not like 'rncp-initial/%')
 with check(bucket_id<>'integraq-private' or name not like 'rncp-initial/%');

create function public.iq_rncp_initial_photo_guard(p_report uuid,p_edit boolean) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(false); r public.supplier_rncp_reports%rowtype;
begin
 if p_edit and not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='PHOTO_FORBIDDEN'; end if;
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org and deleted_at is null and source_kind='native';
 if r.id is null then raise exception using errcode='42501',message='PHOTO_FORBIDDEN'; end if;
 if p_edit and (r.status<>'draft' or r.notified_at is not null) then raise exception 'PHOTO_DRAFT_LOCKED'; end if;
 return org;
end $$;

create function public.iq_rncp_initial_photo_manifest(p_report uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid; ids uuid[]; rev integer; photos jsonb;
begin
 if p_report is null then perform public.iq_rncp_actor_org(false); return jsonb_build_object('available',true); end if;
 org:=public.iq_rncp_initial_photo_guard(p_report,false);
 select file_ids,revision into ids,rev from public.supplier_rncp_initial_photo_sets where report_id=p_report and organization_id=org;
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'sha256',f.sha256,'size',f.size_bytes,'mime',f.mime_type,
  'width',(f.observations::jsonb)->'width','height',(f.observations::jsonb)->'height') order by v.pos),'[]'::jsonb) into photos
 from unnest(coalesce(ids,'{}'::uuid[])) with ordinality v(id,pos) join public.file_objects f on f.id=v.id
 where f.resource_id=p_report and f.resource_type='supplier_rncp_initial_photo' and f.workspace_id=org and f.deleted_at is null;
 if jsonb_array_length(photos)<>coalesce(cardinality(ids),0) then raise exception 'PHOTO_MANIFEST_INCOMPLETE'; end if;
 return jsonb_build_object('revision',coalesce(rev,0),'files',photos);
end $$;

-- Canonical metadata only; no caller-supplied organization, actor, resource type or bucket.
create function public.iq_rncp_initial_photo_reserve(p_report uuid,p_file jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; r public.supplier_rncp_reports%rowtype; prior public.supplier_rncp_initial_photo_reservations%rowtype;
 expected_path text; raw_hex text; expected_id uuid; object_count bigint; object_bytes bigint;
begin
 org:=public.iq_rncp_initial_photo_guard(p_report,true);
 -- Serializes reservations across reports of the SAME authorized organization.
 perform 1 from public.organizations where id=org and active and kind='internal' for update;
 if not found then raise exception using errcode='42501',message='PHOTO_FORBIDDEN'; end if;
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org
  and source_kind='native' and deleted_at is null and status='draft' and notified_at is null for update;
 if not found then raise exception 'PHOTO_DRAFT_LOCKED'; end if;
 if jsonb_typeof(p_file) is distinct from 'object'
  or jsonb_typeof(p_file->'name') is distinct from 'string'
  or coalesce(length(trim(p_file->>'name')),0) not between 1 and 180
  or coalesce(p_file->>'sha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_file->>'mime','') not in ('image/jpeg','image/png','image/webp')
  or jsonb_typeof(p_file->'size') is distinct from 'number'
  or jsonb_typeof(p_file->'width') is distinct from 'number'
  or jsonb_typeof(p_file->'height') is distinct from 'number'
  or coalesce(p_file->>'size','') !~ '^[0-9]+$'
  or coalesce(p_file->>'width','') !~ '^[0-9]+$'
  or coalesce(p_file->>'height','') !~ '^[0-9]+$' then raise exception 'PHOTO_INVALID'; end if;
 if (p_file->>'size')::numeric not between 1 and 4194304
  or (p_file->>'width')::numeric not between 1 and 8192 or (p_file->>'height')::numeric not between 1 and 8192
  or (p_file->>'width')::numeric*(p_file->>'height')::numeric>25000000 then raise exception 'PHOTO_INVALID'; end if;
 expected_path:='rncp-initial/'||org::text||'/'||p_report::text||'/'||(p_file->>'sha256')||
  case p_file->>'mime' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.jpg' end;
 raw_hex:=encode(sha256(convert_to(org::text||':'||p_report::text||':'||(p_file->>'sha256'),'UTF8')),'hex');
 expected_id:=(substr(raw_hex,1,8)||'-'||substr(raw_hex,9,4)||'-5'||substr(raw_hex,14,3)||'-a'||substr(raw_hex,18,3)||'-'||substr(raw_hex,21,12))::uuid;
 if p_file is distinct from jsonb_build_object('id',expected_id,'path',expected_path,'name',p_file->>'name',
   'sha256',p_file->>'sha256','mime',p_file->>'mime','size',(p_file->>'size')::bigint,
   'width',(p_file->>'width')::integer,'height',(p_file->>'height')::integer) then raise exception 'PHOTO_IDENTITY_CONFLICT'; end if;
 select * into prior from public.supplier_rncp_initial_photo_reservations where file_id=expected_id;
 if found then
  if prior.organization_id is distinct from org or prior.report_id is distinct from p_report
   or prior.actor_id is distinct from auth.uid() or prior.file_data is distinct from p_file then raise exception 'PHOTO_IDENTITY_CONFLICT'; end if;
  return jsonb_build_object('id',prior.file_id,'path',prior.object_path,'verified',prior.verified_at is not null);
 end if;
 -- ALL reservations count: staged, committed, removed and abandoned; no expiry or quota release.
 select count(*),coalesce(sum(size_bytes),0) into object_count,object_bytes
 from public.supplier_rncp_initial_photo_reservations where organization_id=org and report_id=p_report;
 if object_count>=24 or object_bytes+(p_file->>'size')::bigint>50331648 then raise exception 'PHOTO_REPORT_PREPARED_QUOTA'; end if;
 select count(*),coalesce(sum(size_bytes),0) into object_count,object_bytes
 from public.supplier_rncp_initial_photo_reservations where organization_id=org;
 if object_count>=240 or object_bytes+(p_file->>'size')::bigint>503316480 then raise exception 'PHOTO_ORG_PREPARED_QUOTA'; end if;
 insert into public.supplier_rncp_initial_photo_reservations(file_id,organization_id,report_id,actor_id,object_path,size_bytes,file_data)
 values(expected_id,org,p_report,auth.uid(),expected_path,(p_file->>'size')::bigint,p_file);
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata)
 values(auth.uid(),org,'suppliers','rncp.initial_photo.reserved','supplier_rncp_report',p_report::text,
  jsonb_build_object('file_id',expected_id,'size',(p_file->>'size')::bigint,'sha256',p_file->>'sha256'));
 return jsonb_build_object('id',expected_id,'path',expected_path,'verified',false);
end $$;

-- Trusted backend ONLY. It must DOWNLOAD the private object and decode/hash its ACTUAL
-- bytes before attesting, deriving this JSON itself. Never forward a browser's JSON.
-- SQL cannot decode image bytes or independently prove the hash of a Storage object.
create function public.iq_rncp_initial_photo_attest(p_file_id uuid,p_verified jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare reserved public.supplier_rncp_initial_photo_reservations%rowtype; object_count bigint; object_bytes numeric;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception using errcode='42501',message='PHOTO_BACKEND_ONLY'; end if;
 select * into reserved from public.supplier_rncp_initial_photo_reservations where file_id=p_file_id for update;
 if not found or reserved.file_data is distinct from p_verified then raise exception 'PHOTO_VERIFICATION_MISMATCH'; end if;
 if not exists(select 1 from storage.objects where bucket_id='integraq-private' and name=reserved.object_path
  and (metadata->>'size')::numeric=reserved.size_bytes and metadata->>'mimetype'=p_verified->>'mime') then raise exception 'PHOTO_OBJECT_UNVERIFIED'; end if;
 -- Actual-object reconciliation detects privileged uploads outside the reservation protocol.
 if exists(select 1 from storage.objects o where o.bucket_id='integraq-private'
  and o.name like 'rncp-initial/'||reserved.organization_id::text||'/%'
  and not exists(select 1 from public.supplier_rncp_initial_photo_reservations a
   where a.organization_id=reserved.organization_id and a.object_path=o.name
    and (o.metadata->>'size')::numeric=a.size_bytes)) then raise exception 'PHOTO_UNRESERVED_OBJECT_REVIEW_REQUIRED'; end if;
 select count(*),coalesce(sum((metadata->>'size')::numeric),0) into object_count,object_bytes
 from storage.objects where bucket_id='integraq-private' and name like 'rncp-initial/'||reserved.organization_id::text||'/'||reserved.report_id::text||'/%';
 if object_count>24 or object_bytes>50331648 then raise exception 'PHOTO_REPORT_PREPARED_QUOTA'; end if;
 select count(*),coalesce(sum((metadata->>'size')::numeric),0) into object_count,object_bytes
 from storage.objects where bucket_id='integraq-private' and name like 'rncp-initial/'||reserved.organization_id::text||'/%';
 if object_count>240 or object_bytes>503316480 then raise exception 'PHOTO_ORG_PREPARED_QUOTA'; end if;
 if reserved.verified_at is null then
  update public.supplier_rncp_initial_photo_reservations set verified_at=now() where file_id=p_file_id;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,metadata)
  values(reserved.actor_id,reserved.organization_id,'suppliers','rncp.initial_photo.backend_verified','supplier_rncp_report',reserved.report_id::text,
   jsonb_build_object('file_id',p_file_id,'sha256',p_verified->>'sha256'));
 end if;
end $$;

-- Prevent namespace aliases, reclassification and file lifecycle RPCs bypassing the manifest.
-- Applies only to the NEW resource/prefix; other file rows return unchanged.
create function public.iq_rncp_initial_photo_file_guard() returns trigger
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
  or new.uploaded_by is distinct from reserved.actor_id or new.deleted_at is not null
  or new.original_name is distinct from reserved.file_data->>'name' or new.sha256 is distinct from reserved.file_data->>'sha256'
  or new.mime_type is distinct from reserved.file_data->>'mime' or new.size_bytes is distinct from reserved.size_bytes
  or new.audience::text is distinct from 'internal' or new.module_id is distinct from 'suppliers'
  or new.external_organization_id is distinct from (select supplier_id from public.supplier_rncp_reports where id=reserved.report_id)
  or new.observations::jsonb is distinct from jsonb_build_object('width',(reserved.file_data->>'width')::integer,'height',(reserved.file_data->>'height')::integer)
 then raise exception 'PHOTO_VERIFICATION_MISMATCH'; end if;
 return new;
end $$;
create trigger rncp_initial_photo_file_guard before insert or update or delete on public.file_objects
 for each row execute function public.iq_rncp_initial_photo_file_guard();

-- Institutional/home signed URLs follow controlled_document_versions.file_id with a
-- privileged client. Prevent an initial photo ever entering that alternative chain.
create function public.iq_rncp_initial_photo_controlled_link_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.file_objects f where f.id=new.file_id and
  (f.resource_type='supplier_rncp_initial_photo' or (f.bucket_id='integraq-private' and f.object_path like 'rncp-initial/%'))) then
  raise exception 'PHOTO_NOT_A_CONTROLLED_DOCUMENT';
 end if;
 return new;
end $$;
create trigger rncp_initial_photo_controlled_link_guard before insert or update of file_id on public.controlled_document_versions
 for each row execute function public.iq_rncp_initial_photo_controlled_link_guard();

create function public.iq_rncp_initial_photo_stage(p_report uuid,p_file jsonb) returns uuid
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
  'supplier_rncp_initial_photo',p_report,r.folio,org,1,true,auth.uid(),'not_required',
  jsonb_build_object('width',(p_file->>'width')::integer,'height',(p_file->>'height')::integer)::text,r.supplier_id);
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,entity_code_snapshot,metadata)
 values(auth.uid(),org,'suppliers','rncp.initial_photo.staged','supplier_rncp_report',p_report::text,r.folio,
  jsonb_build_object('file_id',file_id,'sha256',p_file->>'sha256'));
 return file_id;
end $$;

create function public.iq_rncp_initial_photo_commit(p_report uuid,p_ids uuid[],p_revision integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; r public.supplier_rncp_reports%rowtype; previous public.supplier_rncp_initial_photo_sets%rowtype; found_count integer; total bigint;
begin
 org:=public.iq_rncp_initial_photo_guard(p_report,true);
 select * into r from public.supplier_rncp_reports where id=p_report and organization_id=org
  and source_kind='native' and deleted_at is null and status='draft' and notified_at is null for update;
 if not found then raise exception 'PHOTO_DRAFT_LOCKED'; end if;
 if p_revision is null or p_revision<0 or p_ids is null
  or coalesce(array_ndims(p_ids),1)<>1 or (cardinality(p_ids)>0 and array_lower(p_ids,1)<>1)
  or cardinality(p_ids)>12 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id)
  or coalesce(length(trim(p_reason)),0) not between 5 and 1000 then raise exception 'PHOTO_INVALID'; end if;
 select * into previous from public.supplier_rncp_initial_photo_sets where report_id=p_report and organization_id=org for update;
 if coalesce(previous.revision,0) is distinct from p_revision then
  -- Every stale revision is a conflict, even same actor/files. Recover with GET only.
  raise exception 'PHOTO_CONFLICT';
 end if;
 select count(*),coalesce(sum(f.size_bytes),0) into found_count,total from public.file_objects f
 where f.id=any(p_ids) and f.workspace_id=org and f.resource_id=p_report and f.resource_type='supplier_rncp_initial_photo' and f.deleted_at is null
  and f.bucket_id='integraq-private' and exists(select 1 from storage.objects o where o.bucket_id=f.bucket_id and o.name=f.object_path);
 if found_count<>cardinality(p_ids) or total>25165824 then raise exception 'PHOTO_INVALID'; end if;
 insert into public.supplier_rncp_initial_photo_sets(report_id,organization_id,file_ids,revision,updated_by)
 values(p_report,org,p_ids,coalesce(previous.revision,0)+1,auth.uid())
 on conflict(report_id) do update set file_ids=excluded.file_ids,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now();
 insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,entity_code_snapshot,previous_value,new_value,reason)
 values(auth.uid(),org,'suppliers','rncp.initial_photos.saved','supplier_rncp_report',p_report::text,r.folio,
  jsonb_build_object('ids',coalesce(previous.file_ids,'{}'::uuid[]),'revision',coalesce(previous.revision,0)),
  jsonb_build_object('ids',p_ids,'revision',coalesce(previous.revision,0)+1),trim(p_reason));
 -- Removed photos remain private and intact; the audit preserves their earlier order.
 return public.iq_rncp_initial_photo_manifest(p_report);
end $$;

create function public.iq_rncp_initial_photo_draft(p_request uuid,p_payload jsonb) returns public.supplier_rncp_reports
language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(false); report_id uuid; r public.supplier_rncp_reports%rowtype;
begin
 if p_request is null or not public.has_module_permission('suppliers','update') then raise exception using errcode='42501',message='PHOTO_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||auth.uid()::text||p_request::text,0));
 select d.report_id into report_id from public.supplier_rncp_photo_draft_requests d where d.organization_id=org and d.actor_id=auth.uid() and d.request_key=p_request;
 if report_id is not null then
  perform public.iq_rncp_initial_photo_guard(report_id,false);
  if (select d.request_payload from public.supplier_rncp_photo_draft_requests d
      where d.organization_id=org and d.actor_id=auth.uid() and d.request_key=p_request) is distinct from p_payload then
   raise exception 'PHOTO_REQUEST_REUSED_WITH_DIFFERENT_PAYLOAD';
  end if;
  -- Return CURRENT data. Never re-apply an old payload, change status or write audit on retry.
  select * into r from public.supplier_rncp_reports where id=report_id and organization_id=org
   and source_kind='native' and deleted_at is null;
  if not found then raise exception using errcode='42501',message='PHOTO_FORBIDDEN'; end if;
  return r;
 end if;
 select * into r from public.save_supplier_rncp(null,'draft',p_payload,null);
 insert into public.supplier_rncp_photo_draft_requests(organization_id,actor_id,request_key,request_payload,report_id)
 values(org,auth.uid(),p_request,p_payload,r.id);
 return r;
end $$;
revoke all on function public.iq_rncp_initial_photo_guard(uuid,boolean),public.iq_rncp_initial_photo_manifest(uuid),
 public.iq_rncp_initial_photo_stage(uuid,jsonb),public.iq_rncp_initial_photo_commit(uuid,uuid[],integer,text),public.iq_rncp_initial_photo_draft(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.iq_rncp_initial_photo_manifest(uuid),public.iq_rncp_initial_photo_stage(uuid,jsonb),
 public.iq_rncp_initial_photo_commit(uuid,uuid[],integer,text),public.iq_rncp_initial_photo_draft(uuid,jsonb) to authenticated;
revoke all on function public.iq_rncp_initial_photo_reserve(uuid,jsonb),
 public.iq_rncp_initial_photo_attest(uuid,jsonb),public.iq_rncp_initial_photo_file_guard(),
 public.iq_rncp_initial_photo_controlled_link_guard() from public,anon,authenticated,service_role;
grant execute on function public.iq_rncp_initial_photo_reserve(uuid,jsonb) to authenticated;
grant execute on function public.iq_rncp_initial_photo_attest(uuid,jsonb) to service_role;
commit;
