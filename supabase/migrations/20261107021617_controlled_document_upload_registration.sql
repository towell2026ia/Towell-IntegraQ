-- Targeted proposal. No historical rows, grants, objects or numbering are rewritten.
begin;
create unique index file_objects_controlled_upload_intent on public.file_objects(uploaded_by,resource_key)
 where reference_type='controlled_document_upload';

create function public.iq_document_upload_scope(p_process_id text,p_document_id uuid default null)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles%rowtype; doc public.controlled_documents%rowtype; process_org uuid;
begin
 select p.* into actor from public.profiles p join public.organizations o on o.id=p.organization_id
  where p.id=auth.uid() and p.status='active' and p.user_type in ('administrator','internal')
   and p.workspace_mode='production' and o.kind='internal' and o.active;
 select organization_id into process_org from public.processes where id=p_process_id and active;
 if actor.id is null or process_org is distinct from actor.organization_id
  or not public.has_module_permission('documents','view')
  or not public.has_module_permission('documents','update')
  or not public.has_process_document_role(p_process_id,'modifier') then
  raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 if p_document_id is not null then
  select * into doc from public.controlled_documents where id=p_document_id;
  if doc.id is null or doc.process_id<>p_process_id or coalesce(doc.organization_id,process_org)<>actor.organization_id
   or (actor.user_type<>'administrator' and (not doc.active or doc.deleted_at is not null or exists(
    select 1 from public.document_lifecycle where document_id=doc.id and is_deleted))) then
   raise exception using errcode='42501',message='FORBIDDEN';
  end if;
 end if;
 return actor.organization_id;
end $$;

-- An intent fingerprint is not an authorization token. Every use also verifies
-- current identity, organization, process and the exact file metadata.
create function public.iq_document_upload_key(p_code text,p_title text,p_process text,p_type text,
 p_kind text,p_reason text,p_document uuid,p_base uuid,p_file jsonb)
returns text language sql immutable set search_path='' as $$
 select 'controlled-upload:'||md5(jsonb_build_array(upper(trim(p_code)),trim(p_title),p_process,p_type,p_kind,
  trim(p_reason),p_document,p_base,p_file->>'name',p_file->>'mime',p_file->>'size',p_file->>'sha256')::text)
$$;

create function public.reserve_controlled_document_upload(p_code text,p_title text,p_process_id text,p_document_type_id text,
 p_file jsonb,p_kind text,p_reason text,p_document_id uuid,p_base_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid:=public.iq_document_upload_scope(p_process_id); doc public.controlled_documents%rowtype;
 reserved public.file_objects%rowtype; intent text; base uuid; file_id uuid:=gen_random_uuid(); path text; extension text;
begin
 if nullif(trim(p_code),'') is null or nullif(trim(p_title),'') is null or p_kind is null
  or p_kind not in ('initial','version','revision') or not exists(select 1 from public.document_types where id=p_document_type_id)
  then raise exception using errcode='22023',message='INVALID_DOCUMENT_INPUT'; end if;
 if jsonb_typeof(p_file)<>'object' or coalesce(p_file->>'name','')='' or length(p_file->>'name')>255
  or position('/' in p_file->>'name')>0 or position(chr(92) in p_file->>'name')>0
  or p_file->>'name' ~ '[[:cntrl:]]' or coalesce(p_file->>'sha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_file->>'size','') !~ '^[0-9]+$' or (p_file->>'size')::bigint not between 1 and 52428800
  or p_process_id !~ '^[A-Za-z0-9_-]+$' then raise exception using errcode='22023',message='INVALID_UPLOAD_FILE'; end if;
 extension:=lower(substring(p_file->>'name' from '\.([^.]+)$'));
 if extension is null or extension not in ('pdf','doc','docx','xls','xlsx','xlsm','csv','ppt','pptx','txt','png','jpg','jpeg','webp','gif','odt','ods')
  or lower(coalesce(p_file->>'mime','')) not in ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
   'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel.sheet.macroenabled.12',
   'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','text/csv',
   'image/png','image/jpeg','image/webp','image/gif','application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet','application/octet-stream')
  then raise exception using errcode='22023',message='INVALID_UPLOAD_FILE'; end if;
 intent:=public.iq_document_upload_key(p_code,p_title,p_process_id,p_document_type_id,p_kind,p_reason,p_document_id,p_base_version_id,p_file);
 perform pg_advisory_xact_lock(hashtextextended(upper(trim(p_code)),0));
 select * into reserved from public.file_objects where resource_key=intent and uploaded_by=auth.uid()
  and reference_type='controlled_document_upload' and resource_type='controlled_document' for update;
 if reserved.id is not null then
  if reserved.deleted_at is not null or reserved.workspace_id is distinct from org or reserved.process_id<>p_process_id
   then raise exception using errcode='42501',message='INVALID_UPLOAD_REFERENCE'; end if;
  if reserved.validity_status='upload_registered' then
   perform public.iq_document_upload_scope(p_process_id,reserved.resource_id);
   if not exists(select 1 from public.controlled_document_versions v where v.document_id=reserved.resource_id and v.file_id=reserved.id)
    then raise exception 'INVALID_UPLOAD_REFERENCE'; end if;
  end if;
  return jsonb_build_object('fileId',reserved.id,'objectPath',reserved.object_path,'state',reserved.validity_status,
   'documentId',case when reserved.validity_status='upload_registered' then reserved.resource_id end);
 end if;
 select * into doc from public.controlled_documents where upper(trim(code))=upper(trim(p_code)) for update;
 if p_kind='initial' then
  if doc.id is not null then raise exception using errcode='23505',message='DOCUMENT_CODE_EXISTS'; end if;
  if upper(trim(p_code)) !~ '^[A-Z0-9]+([-._/][A-Z0-9]+)*_?$' then raise exception using errcode='22023',message='INVALID_DOCUMENT_CODE'; end if;
 else
  if doc.id is null or doc.id is distinct from p_document_id then raise exception using errcode='40001',message='DOCUMENT_CHANGED'; end if;
  perform public.iq_document_upload_scope(p_process_id,doc.id);
  if doc.document_type_id<>p_document_type_id then raise exception 'DOCUMENT_SCOPE_MISMATCH'; end if;
  select id into base from public.controlled_document_versions where document_id=doc.id order by revision desc limit 1;
  if base is distinct from p_base_version_id then raise exception using errcode='40001',message='DOCUMENT_CHANGED'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
  if exists(select 1 from public.controlled_document_versions where document_id=doc.id and status='pending') then raise exception 'DOCUMENT_PENDING_REVIEW'; end if;
 end if;
 path:=auth.uid()::text||'/documents/'||p_process_id||'/'||file_id::text||'/'||right(regexp_replace(p_file->>'name','[^A-Za-z0-9._-]+','-','g'),140);
 insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,uploaded_by,workspace_id,
  process_id,module_id,audience,resource_type,resource_id,category,reference_type,validity_status,resource_key)
 values(file_id,'integraq-private',path,p_file->>'name',p_file->>'mime',(p_file->>'size')::bigint,p_file->>'sha256',auth.uid(),org,
  p_process_id,'documents','internal','controlled_document',doc.id,p_document_type_id,'controlled_document_upload','upload_pending',intent);
 return jsonb_build_object('fileId',file_id,'objectPath',path,'state','upload_pending','documentId',null);
end $$;

create or replace function public.iq_document_admin_scope(p_process_id text, p_document_id uuid default null)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor_org uuid; process_org uuid;
begin
  select p.organization_id into actor_org from public.profiles p
    join public.organizations o on o.id=p.organization_id
    where p.id=auth.uid() and p.user_type='administrator' and p.status='active' and p.workspace_mode='production'
      and o.kind='internal' and o.active;
  select organization_id into process_org from public.processes where id=p_process_id and active;
  if actor_org is null or process_org is distinct from actor_org or
    (p_document_id is not null and not exists (select 1 from public.controlled_documents
      where id=p_document_id and process_id=p_process_id and coalesce(organization_id,process_org)=actor_org)) then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  return actor_org;
end $$;

create or replace function public.inspect_controlled_document_code(p_code text, p_process_id text, p_document_type_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare selected public.controlled_documents%rowtype; result jsonb;
begin
  perform public.iq_document_upload_scope(p_process_id);
  if not exists(select 1 from public.document_types where id=p_document_type_id) then
    raise exception using errcode='22023', message='INVALID_DOCUMENT_TYPE';
  end if;
  select * into selected from public.controlled_documents where upper(trim(code))=upper(trim(p_code));
  if selected.id is null then return null; end if;
  perform public.iq_document_upload_scope(selected.process_id, selected.id);
  result := jsonb_build_object('id',selected.id,'code',selected.code,'title',selected.title,
    'processId',selected.process_id,'documentTypeId',selected.document_type_id,
    'deleted',selected.deleted_at is not null or exists(select 1 from public.document_lifecycle where document_id=selected.id and is_deleted),
    'compatible',selected.process_id=p_process_id and selected.document_type_id=p_document_type_id,
    'baseVersionId',(select id from public.controlled_document_versions where document_id=selected.id order by revision desc limit 1),
    'pending',exists(select 1 from public.controlled_document_versions where document_id=selected.id and status='pending'));
  return result;
end $$;

create or replace function public.register_controlled_document_upload(
  p_code text, p_title text, p_process_id text, p_document_type_id text,
  p_file_id uuid, p_kind text, p_reason text,
  p_document_id uuid default null, p_base_version_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare org uuid; doc public.controlled_documents%rowtype;
declare source public.controlled_document_versions%rowtype; file public.file_objects%rowtype;
declare next_revision integer; business_version integer; correction integer; legacy integer;
declare new_id uuid := gen_random_uuid(); validator uuid;
begin
  org := public.iq_document_upload_scope(p_process_id);
  if nullif(trim(p_code),'') is null or nullif(trim(p_title),'') is null or
    p_kind not in ('initial','version','revision') or p_kind is null then
    raise exception using errcode='22023', message='INVALID_DOCUMENT_INPUT';
  end if;
  if not exists(select 1 from public.document_types where id=p_document_type_id) then
    raise exception using errcode='22023', message='INVALID_DOCUMENT_TYPE';
  end if;
  -- All attempts at the same normalized code serialize, including first creation.
  perform pg_advisory_xact_lock(hashtextextended(upper(trim(p_code)),0));
  select * into doc from public.controlled_documents where upper(trim(code))=upper(trim(p_code)) for update;
  select * into file from public.file_objects where id=p_file_id for update;
  if file.reference_type='controlled_document_upload' then
    if file.uploaded_by is distinct from auth.uid() or file.workspace_id is distinct from org or file.deleted_at is not null
      or file.resource_key is distinct from public.iq_document_upload_key(p_code,p_title,p_process_id,p_document_type_id,
        p_kind,p_reason,p_document_id,p_base_version_id,jsonb_build_object('name',file.original_name,'mime',file.mime_type,'size',file.size_bytes,'sha256',file.sha256))
    then raise exception using errcode='42501',message='INVALID_UPLOAD_REFERENCE'; end if;
    if file.validity_status='upload_registered' then
      if doc.id is null or file.resource_id is distinct from doc.id or not exists(select 1 from public.controlled_document_versions where document_id=doc.id and file_id=file.id)
      then raise exception using errcode='42501',message='INVALID_UPLOAD_REFERENCE'; end if;
      perform public.iq_document_upload_scope(p_process_id,doc.id);
      return doc.id;
    end if;
    if file.validity_status<>'upload_pending' or not exists(select 1 from storage.objects o where o.bucket_id=file.bucket_id and o.name=file.object_path
      and o.owner_id=auth.uid()::text and o.metadata->>'size'=file.size_bytes::text)
    then raise exception using errcode='42501',message='INVALID_UPLOAD_REFERENCE'; end if;
  end if;
  if p_kind='initial' and doc.id is null and upper(trim(p_code)) !~ '^[A-Z0-9]+([-._/][A-Z0-9]+)*_?$' then
    raise exception using errcode='22023',message='INVALID_DOCUMENT_CODE';
  end if;
  if p_kind='initial' and doc.id is not null then
    raise exception using errcode='23505', message='DOCUMENT_CODE_EXISTS';
  end if;
  if p_kind<>'initial' then
    if doc.id is null or doc.id is distinct from p_document_id then
      raise exception using errcode='40001', message='DOCUMENT_CHANGED';
    end if;
    perform public.iq_document_upload_scope(p_process_id,doc.id);
    if doc.document_type_id<>p_document_type_id then
      raise exception using errcode='22023', message='DOCUMENT_SCOPE_MISMATCH';
    end if;
    select * into source from public.controlled_document_versions where document_id=doc.id order by revision desc limit 1;
    if source.id is distinct from p_base_version_id then
      raise exception using errcode='40001', message='DOCUMENT_CHANGED';
    end if;
    if exists(select 1 from public.controlled_document_versions where document_id=doc.id and status='pending') then
      raise exception using errcode='55000', message='DOCUMENT_PENDING_REVIEW';
    end if;
    if nullif(trim(p_reason),'') is null then raise exception using errcode='22023', message='REASON_REQUIRED'; end if;
  end if;
  select * into file from public.file_objects where id=p_file_id for update;
  if file.id is null or file.uploaded_by is distinct from auth.uid() or file.deleted_at is not null
    or file.bucket_id is distinct from 'integraq-private' or file.module_id is distinct from 'documents'
    or file.resource_type is distinct from 'controlled_document' or file.audience is distinct from 'internal'
    or file.process_id is distinct from p_process_id or file.category is distinct from p_document_type_id
    or (file.resource_id is not null and file.resource_id is distinct from doc.id)
    or file.size_bytes is null or file.size_bytes not between 1 and 52428800
    or split_part(file.object_path,'/',1) is distinct from auth.uid()::text
    or split_part(file.object_path,'/',2) is distinct from 'documents'
    or not exists(select 1 from storage.objects where bucket_id=file.bucket_id and name=file.object_path)
    or exists(select 1 from public.controlled_document_versions where file_id=file.id) then
    raise exception using errcode='42501', message='INVALID_FILE_REFERENCE';
  end if;
  if p_kind='initial' then
    insert into public.controlled_documents(process_id,document_type_id,code,title,organization_id,owner_id,created_by)
      values(p_process_id,p_document_type_id,upper(trim(p_code)),trim(p_title),org,auth.uid(),auth.uid()) returning * into doc;
    business_version:=0; correction:=0; next_revision:=0;
  else
    next_revision:=coalesce(source.revision,-1)+1;
    -- Number a correction against the operative version, not a rejected proposal.
    select * into source from public.controlled_document_versions where document_id=doc.id
      order by (status='current') desc, revision desc limit 1;
    if source.id is null and p_kind='revision' then
      raise exception using errcode='55000',message='REPLACEMENT_REQUIRED';
    end if;
    if p_kind='version' then
      -- Reserve historical identifiers as the floor for NEW explicit numbering;
      -- historical rows remain NULL in version_number and retain their labels.
      select coalesce(max(coalesce(version_number,legacy_revision,revision)),-1)+1 into business_version
        from public.controlled_document_versions where document_id=doc.id;
      correction:=0;
    else
      business_version:=source.version_number;
      legacy:=case when business_version is null then coalesce(source.legacy_revision,source.revision) end;
      correction:=coalesce(source.revision_sequence,0)+1;
    end if;
    -- Superseded drafts/rejections remain in history, never two work-in-progress rows.
    update public.controlled_document_versions set status='obsolete'
      where document_id=doc.id and status in ('draft','rejected');
  end if;
  validator:=doc.owner_id;
  update public.file_objects set resource_id=doc.id,workspace_id=org,
    validity_status=case when reference_type='controlled_document_upload' then 'upload_registered' else validity_status end,
    updated_by=auth.uid() where id=file.id;
  insert into public.controlled_document_versions(id,document_id,revision,version_number,revision_sequence,
    legacy_revision,replacement_kind,replaces_version_id,status,file_id,file_name,change_reason,
    uploaded_by,validator_id,submitted_by,submitted_at)
    values(new_id,doc.id,next_revision,business_version,correction,legacy,p_kind,source.id,'pending',file.id,
      file.original_name,coalesce(nullif(trim(p_reason),''),'Carga inicial'),auth.uid(),validator,auth.uid(),now());
  insert into public.document_workflow_events(document_id,version_id,action,actor_id,comment)
    values(doc.id,new_id,'created',auth.uid(),p_reason),(doc.id,new_id,'submitted',auth.uid(),p_reason);
  insert into public.document_audit_log(document_id,document_version_id,event_type,reason,performed_by,metadata)
    values(doc.id,new_id,case when p_kind='initial' then 'DOCUMENT_CREATED' else 'VERSION_CREATED' end,
      p_reason,auth.uid(),jsonb_build_object('replacement_kind',p_kind,'previous_version_id',source.id,
      'previous_file_id',source.file_id,'new_file_id',file.id,'version_number',business_version,
      'legacy_revision',legacy,'revision_sequence',correction,'process_id',p_process_id));
  return doc.id;
end $$;

create or replace function public.review_document_version(requested_version_id uuid, decision text, review_comment text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare doc public.controlled_documents%rowtype; candidate public.controlled_document_versions%rowtype; actor public.profiles%rowtype;
begin
  if decision is null or decision not in ('approve','reject') then raise exception 'Decision invalida.'; end if;
  select d.* into doc from public.controlled_documents d join public.controlled_document_versions v on v.document_id=d.id
    where v.id=requested_version_id for update of d;
  select * into candidate from public.controlled_document_versions where id=requested_version_id and status='pending' for update;
  if candidate.id is null then raise exception 'La version no esta pendiente de autorizacion.'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active' and workspace_mode='production' and user_type in ('administrator','internal');
  if actor.id is null or actor.organization_id is distinct from coalesce(doc.organization_id,(select organization_id from public.processes where id=doc.process_id))
    or not public.has_process_document_role(doc.process_id,'authorizer') then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if decision='approve' then
    if (doc.deleted_at is not null or exists(select 1 from public.document_lifecycle where document_id=doc.id and is_deleted))
      and candidate.replacement_kind is null then
      raise exception using errcode='55000',message='REPLACEMENT_REQUIRED';
    end if;
    update public.controlled_document_versions set status='obsolete' where document_id=doc.id and status='current';
    update public.controlled_document_versions set status='current',validator_id=auth.uid(),authorized_by=auth.uid(),
      authorized_at=now(),rejection_reason=null where id=candidate.id;
    if candidate.replacement_kind is not null then
      -- The original retirement reason/actor/date remain in lifecycle AND audit.
      insert into public.document_audit_log(document_id,document_version_id,event_type,previous_state,new_state,reason,performed_by,metadata)
        values(doc.id,candidate.id,'FILE_REPLACED',to_jsonb(doc),jsonb_build_object('file_id',candidate.file_id),
          candidate.change_reason,auth.uid(),jsonb_build_object('previous_version_id',candidate.replaces_version_id,
          'previous_file_id',(select file_id from public.controlled_document_versions where id=candidate.replaces_version_id)));
      update public.document_lifecycle set lifecycle_status='active',is_deleted=false,restored_at=now(),restored_by=auth.uid()
        where document_id=doc.id;
      update public.controlled_documents set active=true,deleted_at=null where id=doc.id;
    end if;
  else
    if nullif(trim(review_comment),'') is null then raise exception using errcode='22023',message='REASON_REQUIRED'; end if;
    update public.controlled_document_versions set status='rejected',validator_id=auth.uid(),rejected_by=auth.uid(),
      rejected_at=now(),rejection_reason=trim(review_comment) where id=candidate.id;
  end if;
  insert into public.document_workflow_events(document_id,version_id,action,actor_id,comment)
    values(doc.id,candidate.id,case when decision='approve' then 'approved'::public.document_workflow_action else 'rejected'::public.document_workflow_action end,auth.uid(),review_comment);
  insert into public.document_audit_log(document_id,document_version_id,event_type,new_state,reason,performed_by,metadata)
    values(doc.id,candidate.id,case when decision='approve' then 'VERSION_APPROVED' else 'VERSION_REJECTED' end,
      jsonb_build_object('status',case when decision='approve' then 'current' else 'rejected' end),review_comment,auth.uid(),jsonb_build_object('process_id',doc.process_id));
  return candidate.id;
end $$;

create or replace function public.submit_document_version(requested_version_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare doc public.controlled_documents%rowtype; candidate public.controlled_document_versions%rowtype; actor public.profiles%rowtype;
begin
  select d.* into doc from public.controlled_documents d join public.controlled_document_versions v on v.document_id=d.id
    where v.id=requested_version_id for update of d;
  select * into candidate from public.controlled_document_versions where id=requested_version_id and status in ('draft','rejected') for update;
  if candidate.id is null then raise exception 'La version no esta disponible para envio.'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active' and workspace_mode='production' and user_type in ('administrator','internal');
  if actor.id is null or actor.organization_id is distinct from coalesce(doc.organization_id,(select organization_id from public.processes where id=doc.process_id))
    or not public.has_module_permission('documents','update') or not public.has_process_document_role(doc.process_id,'modifier') then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if exists(select 1 from public.controlled_document_versions where document_id=doc.id and status='pending' and id<>candidate.id) then
    raise exception using errcode='55000',message='DOCUMENT_PENDING_REVIEW';
  end if;
  if doc.deleted_at is not null and candidate.replacement_kind is null then
    raise exception using errcode='55000',message='REPLACEMENT_REQUIRED';
  end if;
  update public.controlled_document_versions set status='pending',submitted_by=auth.uid(),submitted_at=now(),
    rejection_reason=null,rejected_by=null,rejected_at=null where id=candidate.id;
  insert into public.document_workflow_events(document_id,version_id,action,actor_id) values(doc.id,candidate.id,'submitted',auth.uid());
  insert into public.document_audit_log(document_id,document_version_id,event_type,new_state,performed_by,metadata)
    values(doc.id,candidate.id,'VERSION_SUBMITTED',jsonb_build_object('status','pending'),auth.uid(),jsonb_build_object('process_id',doc.process_id));
  return candidate.id;
end $$;

create function public.iq_document_scope_values(p_process text,p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles a join public.organizations o on o.id=a.organization_id
  join public.processes p on p.id=p_process and p.organization_id=a.organization_id
  where a.id=auth.uid() and a.status='active' and a.user_type in ('administrator','internal')
   and a.workspace_mode='production' and o.kind='internal' and o.active
   and coalesce(p_org,p.organization_id)=a.organization_id and public.has_module_permission('documents','view')
   and (a.user_type='administrator' or public.has_process_access(p.id)))
$$;
create function public.iq_document_record_scope(p_document uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.controlled_documents d where d.id=p_document
  and public.iq_document_scope_values(d.process_id,d.organization_id))
$$;

create or replace function public.iq_can_read_document_file(p_file_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare f public.file_objects%rowtype; d public.controlled_documents%rowtype; actor public.profiles%rowtype;
 retired boolean; associated integer;
begin
 select * into f from public.file_objects where id=p_file_id and resource_type='controlled_document';
 if f.id is null then return false; end if;
 select * into actor from public.profiles where id=auth.uid() and status='active'
  and user_type in ('administrator','internal') and workspace_mode='production';
 if actor.id is null then return false; end if;
 select count(distinct document_id) into associated from public.controlled_document_versions where file_id=f.id;
 if associated=0 then
  if f.uploaded_by is distinct from actor.id or f.deleted_at is not null then return false; end if;
  begin perform public.iq_document_upload_scope(f.process_id); exception when insufficient_privilege then return false; end;
  return f.workspace_id is null or f.workspace_id=actor.organization_id;
 end if;
 if associated<>1 then return false; end if;
 select doc.* into d from public.controlled_documents doc join public.controlled_document_versions v on v.document_id=doc.id where v.file_id=f.id limit 1;
 if not public.iq_document_scope_values(d.process_id,d.organization_id)
  or (f.workspace_id is not null and f.workspace_id<>actor.organization_id)
  or (f.resource_id is not null and f.resource_id<>d.id)
  or (f.process_id is not null and f.process_id<>d.process_id) then return false; end if;
 if actor.user_type='administrator' then return true; end if;
 if public.has_permission('documents.history',null,null,d.process_id,null,false,null)
  or public.has_process_document_role(d.process_id,'authorizer') then return true; end if;
 retired:=not d.active or d.deleted_at is not null or exists(select 1 from public.document_lifecycle where document_id=d.id and is_deleted);
 if retired or f.deleted_at is not null then return false; end if;
 if exists(select 1 from public.controlled_document_versions where document_id=d.id and file_id=f.id and status='current') then return true; end if;
 if exists(select 1 from public.controlled_document_versions where document_id=d.id and file_id=f.id
  and uploaded_by=actor.id and status in ('draft','pending','rejected')) then
  begin perform public.iq_document_upload_scope(d.process_id,d.id); return true; exception when insufficient_privilege then return false; end;
 end if;
 return false;
end $$;

-- Registered originals and previews are immutable through raw REST/Storage writes.
create function public.iq_document_original_object(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_bucket='integraq-private' and (p_path ~ '^[0-9a-f-]{36}/documents/' or exists(
  select 1 from public.file_objects f where f.resource_type='controlled_document' and f.bucket_id=p_bucket
   and (f.object_path=p_path or f.preview_path=p_path)))
$$;
create function public.iq_document_reserved_object(p_bucket text,p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare f public.file_objects%rowtype; org uuid;
begin
 select * into f from public.file_objects where bucket_id=p_bucket and object_path=p_path
  and resource_type='controlled_document' and reference_type='controlled_document_upload'
  and validity_status='upload_pending' and deleted_at is null and uploaded_by=auth.uid();
 if f.id is null then return false; end if;
 begin org:=public.iq_document_upload_scope(f.process_id); exception when insufficient_privilege then return false; end;
 return f.workspace_id=org and split_part(f.object_path,'/',1)=auth.uid()::text;
end $$;

create policy iq_document_organization_scope on public.controlled_documents as restrictive for all to authenticated
 using(public.iq_document_scope_values(process_id,organization_id)) with check(public.iq_document_scope_values(process_id,organization_id));
create policy iq_document_version_organization_scope on public.controlled_document_versions as restrictive for all to authenticated
 using(public.iq_document_record_scope(document_id)) with check(public.iq_document_record_scope(document_id));
create policy iq_document_version_authorized_history on public.controlled_document_versions for select to authenticated
 using(public.iq_document_record_scope(document_id) and exists(select 1 from public.controlled_documents d where d.id=document_id
  and (public.has_process_document_role(d.process_id,'authorizer') or public.has_permission('documents.history',null,null,d.process_id,null,false,null))));
create policy iq_document_lifecycle_organization_scope on public.document_lifecycle as restrictive for select to authenticated using(public.iq_document_record_scope(document_id));
create policy iq_document_audit_organization_scope on public.document_audit_log as restrictive for select to authenticated using(public.iq_document_record_scope(document_id));
create policy iq_document_workflow_organization_scope on public.document_workflow_events as restrictive for select to authenticated using(public.iq_document_record_scope(document_id));
create policy iq_document_no_physical_delete on public.controlled_documents as restrictive for delete to authenticated using(false);
create policy iq_document_version_no_physical_delete on public.controlled_document_versions as restrictive for delete to authenticated using(false);
create policy iq_document_file_workflow_insert on public.file_objects as restrictive for insert to authenticated with check(resource_type<>'controlled_document');
create policy iq_document_file_workflow_update on public.file_objects as restrictive for update to authenticated
 using(resource_type<>'controlled_document') with check(resource_type<>'controlled_document');
create policy iq_document_file_no_physical_delete on public.file_objects as restrictive for delete to authenticated using(resource_type<>'controlled_document');
create policy iq_document_storage_reserved_insert on storage.objects as restrictive for insert to authenticated
 with check(not public.iq_document_original_object(bucket_id,name) or public.iq_document_reserved_object(bucket_id,name));
create policy iq_document_storage_upload on storage.objects for insert to authenticated
 with check(public.iq_document_reserved_object(bucket_id,name));
create policy iq_document_storage_no_overwrite on storage.objects as restrictive for update to authenticated
 using(not public.iq_document_original_object(bucket_id,name)) with check(not public.iq_document_original_object(bucket_id,name));
create policy iq_document_storage_no_physical_delete on storage.objects as restrictive for delete to authenticated
 using(not public.iq_document_original_object(bucket_id,name));

-- Retirement remains administrative, now with an explicit organization check.
create or replace function public.soft_delete_document(p_document_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare doc public.controlled_documents%rowtype;
begin
 select * into doc from public.controlled_documents where id=p_document_id for update;
 perform public.iq_document_admin_scope(doc.process_id,doc.id);
 if nullif(trim(p_reason),'') is null then raise exception using errcode='22023',message='REASON_REQUIRED'; end if;
 insert into public.document_lifecycle(document_id,lifecycle_status,is_deleted,deleted_at,deleted_by,delete_reason)
 values(doc.id,'deleted',true,now(),auth.uid(),trim(p_reason)) on conflict(document_id) do update set
  lifecycle_status='deleted',is_deleted=true,deleted_at=now(),deleted_by=auth.uid(),delete_reason=excluded.delete_reason;
 update public.controlled_documents set deleted_at=now(),deleted_by=auth.uid(),deletion_reason=trim(p_reason) where id=doc.id;
 insert into public.document_audit_log(document_id,event_type,previous_state,new_state,reason,performed_by,metadata)
 values(doc.id,'DOCUMENT_DELETED',to_jsonb(doc),jsonb_build_object('is_deleted',true),trim(p_reason),auth.uid(),jsonb_build_object('process_id',doc.process_id));
end $$;

revoke all on function public.iq_document_upload_scope(text,uuid),public.iq_document_upload_key(text,text,text,text,text,text,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.reserve_controlled_document_upload(text,text,text,text,jsonb,text,text,uuid,uuid),
 public.iq_document_scope_values(text,uuid),public.iq_document_record_scope(uuid),public.iq_document_original_object(text,text),public.iq_document_reserved_object(text,text) from public,anon;
grant execute on function public.reserve_controlled_document_upload(text,text,text,text,jsonb,text,text,uuid,uuid),
 public.iq_document_scope_values(text,uuid),public.iq_document_record_scope(uuid),public.iq_document_original_object(text,text),public.iq_document_reserved_object(text,text) to authenticated;
revoke all on function public.soft_delete_document(uuid,text) from public,anon;
grant execute on function public.soft_delete_document(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;

