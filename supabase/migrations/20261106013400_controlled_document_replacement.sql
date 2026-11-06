-- Targeted document replacement only. No historical numbering or files are rewritten.
-- revision remains the immutable, unique legacy/technical sequence.
-- version_number is explicit only for NEW records. A correction to a legacy row
-- keeps legacy_revision; it does not reinterpret that row as a version.
alter table public.controlled_document_versions
  add column version_number integer check (version_number >= 0),
  add column revision_sequence integer check (revision_sequence >= 0),
  add column legacy_revision integer check (legacy_revision >= 0),
  add column replacement_kind text check (replacement_kind in ('initial','version','revision','restoration')),
  add column replaces_version_id uuid references public.controlled_document_versions(id) on delete restrict;

-- Fails atomically if pre-existing normalized identities conflict; never merges them.
create unique index controlled_documents_normalized_code_idx on public.controlled_documents(upper(trim(code)));

create or replace function public.iq_document_admin_scope(p_process_id text, p_document_id uuid default null)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor_org uuid; process_org uuid;
begin
  select p.organization_id into actor_org from public.profiles p
    join public.organizations o on o.id=p.organization_id
    where p.id=auth.uid() and p.user_type='administrator' and p.status='active'
      and o.kind='internal' and o.active;
  select organization_id into process_org from public.processes where id=p_process_id and active;
  if actor_org is null or process_org is distinct from actor_org or
    (p_document_id is not null and not exists (select 1 from public.controlled_documents
      where id=p_document_id and process_id=p_process_id and coalesce(organization_id,process_org)=actor_org)) then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  return actor_org;
end $$;

-- Read-only discovery includes retired identities; it never revives a document.
create or replace function public.inspect_controlled_document_code(p_code text, p_process_id text, p_document_type_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare selected public.controlled_documents%rowtype; result jsonb;
begin
  perform public.iq_document_admin_scope(p_process_id);
  if not exists(select 1 from public.document_types where id=p_document_type_id) then
    raise exception using errcode='22023', message='INVALID_DOCUMENT_TYPE';
  end if;
  select * into selected from public.controlled_documents where upper(trim(code))=upper(trim(p_code));
  if selected.id is null then return null; end if;
  perform public.iq_document_admin_scope(selected.process_id, selected.id);
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
  org := public.iq_document_admin_scope(p_process_id);
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
  if p_kind='initial' and doc.id is not null then
    raise exception using errcode='23505', message='DOCUMENT_CODE_EXISTS';
  end if;
  if p_kind<>'initial' then
    if doc.id is null or doc.id is distinct from p_document_id then
      raise exception using errcode='40001', message='DOCUMENT_CHANGED';
    end if;
    perform public.iq_document_admin_scope(p_process_id,doc.id);
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
  update public.file_objects set resource_id=doc.id where id=file.id;
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

-- Existing entry points keep their signatures; approval locks the parent first.
create or replace function public.review_document_version(requested_version_id uuid, decision text, review_comment text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare doc public.controlled_documents%rowtype; candidate public.controlled_document_versions%rowtype; actor public.profiles%rowtype;
begin
  if decision is null or decision not in ('approve','reject') then raise exception 'Decision invalida.'; end if;
  select d.* into doc from public.controlled_documents d join public.controlled_document_versions v on v.document_id=d.id
    where v.id=requested_version_id for update of d;
  select * into candidate from public.controlled_document_versions where id=requested_version_id and status='pending' for update;
  if candidate.id is null then raise exception 'La version no esta pendiente de autorizacion.'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal');
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

-- Restoration re-submits the preserved original; it does not publish it.
create or replace function public.restore_document(p_document_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare doc public.controlled_documents%rowtype; source public.controlled_document_versions%rowtype; candidate uuid:=gen_random_uuid(); next_revision integer;
begin
  select * into doc from public.controlled_documents where id=p_document_id for update;
  perform public.iq_document_admin_scope(doc.process_id,doc.id);
  if doc.deleted_at is null and not exists(select 1 from public.document_lifecycle where document_id=doc.id and is_deleted) then
    raise exception using errcode='55000',message='DOCUMENT_NOT_DELETED';
  end if;
  if exists(select 1 from public.controlled_document_versions where document_id=doc.id and status='pending') then
    raise exception using errcode='55000',message='DOCUMENT_PENDING_REVIEW';
  end if;
  select * into source from public.controlled_document_versions where document_id=doc.id and status='current' order by revision desc limit 1;
  if source.file_id is null then raise exception using errcode='55000',message='REPLACEMENT_REQUIRED'; end if;
  select max(revision)+1 into next_revision from public.controlled_document_versions where document_id=doc.id;
  insert into public.controlled_document_versions(id,document_id,revision,version_number,revision_sequence,legacy_revision,
    replacement_kind,replaces_version_id,status,file_id,file_name,change_reason,uploaded_by,submitted_by,submitted_at)
    values(candidate,doc.id,next_revision,source.version_number,coalesce(source.revision_sequence,0),
      case when source.version_number is null then coalesce(source.legacy_revision,source.revision) end,
      'restoration',source.id,'pending',source.file_id,source.file_name,'Recuperación solicitada por administrador; requiere autorización',auth.uid(),auth.uid(),now());
  insert into public.document_workflow_events(document_id,version_id,action,actor_id) values(doc.id,candidate,'submitted',auth.uid());
  insert into public.document_audit_log(document_id,document_version_id,event_type,performed_by,metadata)
    values(doc.id,candidate,'VERSION_SUBMITTED',auth.uid(),jsonb_build_object('restoration_requested',true,'previous_version_id',source.id));
end $$;

create or replace function public.submit_document_version(requested_version_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare doc public.controlled_documents%rowtype; candidate public.controlled_document_versions%rowtype; actor public.profiles%rowtype;
begin
  select d.* into doc from public.controlled_documents d join public.controlled_document_versions v on v.document_id=d.id
    where v.id=requested_version_id for update of d;
  select * into candidate from public.controlled_document_versions where id=requested_version_id and status in ('draft','rejected') for update;
  if candidate.id is null then raise exception 'La version no esta disponible para envio.'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal');
  if actor.id is null or actor.organization_id is distinct from coalesce(doc.organization_id,(select organization_id from public.processes where id=doc.process_id))
    or not public.has_process_document_role(doc.process_id,'modifier') then
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

-- Direct REST writes cannot forge explicit numbers or bypass approval. Invoker
-- context distinguishes callers from the audited SECURITY DEFINER entry points.
create function public.iq_guard_document_replacement() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated','anon') and
    (new.replacement_kind is not null or (tg_op='UPDATE' and old.replacement_kind is not null)) then
    raise exception using errcode='42501',message='USE_DOCUMENT_WORKFLOW';
  end if;
  if tg_op='INSERT' and new.replacement_kind is null and exists(select 1 from public.controlled_document_versions
    where document_id=new.document_id and replacement_kind is not null) then
    raise exception using errcode='42501',message='USE_DOCUMENT_WORKFLOW';
  end if;
  if tg_op='UPDATE' and old.replacement_kind is not null and
    (new.document_id,new.revision,new.version_number,new.revision_sequence,new.legacy_revision,new.file_id,new.replaces_version_id,new.replacement_kind)
    is distinct from
    (old.document_id,old.revision,old.version_number,old.revision_sequence,old.legacy_revision,old.file_id,old.replaces_version_id,old.replacement_kind) then
    raise exception using errcode='42501',message='IMMUTABLE_DOCUMENT_VERSION';
  end if;
  return new;
end $$;
create trigger iq_document_replacement_guard before insert or update on public.controlled_document_versions
  for each row execute function public.iq_guard_document_replacement();

-- Scoped AND guards: unrelated file resources and untouched legacy documents
-- retain their existing policies. Retired/replaced originals require history access.
create function public.iq_can_read_document_file(p_file_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare doc public.controlled_documents%rowtype; actor public.profiles%rowtype; guarded boolean;
begin
  select d.* into doc from public.controlled_documents d join public.controlled_document_versions v on v.document_id=d.id
    where v.file_id=p_file_id limit 1;
  if doc.id is null then
    -- Uploaded-but-not-registered candidates must not leak through broad file policies.
    return exists(select 1 from public.file_objects f join public.processes p on p.id=f.process_id
      join public.profiles actor on actor.organization_id=p.organization_id
      where f.id=p_file_id and actor.id=auth.uid() and actor.user_type='administrator' and actor.status='active');
  end if;
  guarded:=doc.deleted_at is not null or exists(select 1 from public.controlled_document_versions where document_id=doc.id and replacement_kind is not null);
  if not guarded then return true; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal');
  if actor.id is null or actor.organization_id is distinct from coalesce(doc.organization_id,(select organization_id from public.processes where id=doc.process_id)) then return false; end if;
  if actor.user_type='administrator' then return true; end if;
  if not public.has_process_access(doc.process_id) then return false; end if;
  return (public.has_permission('documents.history',null,null,doc.process_id,null,false,null))
    or public.has_process_document_role(doc.process_id,'authorizer')
    or (doc.deleted_at is null and not exists(select 1 from public.document_lifecycle where document_id=doc.id and is_deleted)
      and exists(select 1 from public.controlled_document_versions where document_id=doc.id and file_id=p_file_id and status='current'));
end $$;
create policy iq_document_replacement_file_read on public.file_objects as restrictive for select to authenticated
  using (resource_type<>'controlled_document' or public.iq_can_read_document_file(id));
create function public.iq_can_read_document_object(p_bucket text,p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.file_objects f where f.resource_type='controlled_document'
    and f.bucket_id=p_bucket and (f.object_path=p_path or f.preview_path=p_path)
    and not public.iq_can_read_document_file(f.id));
$$;
create policy iq_document_replacement_storage_read on storage.objects as restrictive for select to authenticated
  using(public.iq_can_read_document_object(bucket_id,name));

revoke all on function public.iq_document_admin_scope(text,uuid), public.inspect_controlled_document_code(text,text,text),
  public.register_controlled_document_upload(text,text,text,text,uuid,text,text,uuid,uuid),
  public.iq_can_read_document_file(uuid), public.iq_can_read_document_object(text,text), public.iq_guard_document_replacement() from public,anon;
grant execute on function public.iq_document_admin_scope(text,uuid), public.inspect_controlled_document_code(text,text,text),
  public.register_controlled_document_upload(text,text,text,text,uuid,text,text,uuid,uuid),
  public.iq_can_read_document_file(uuid), public.iq_can_read_document_object(text,text) to authenticated;
revoke all on function public.restore_document(uuid), public.review_document_version(uuid,text,text),public.submit_document_version(uuid) from public,anon;
grant execute on function public.restore_document(uuid), public.review_document_version(uuid,text,text),public.submit_document_version(uuid) to authenticated;
notify pgrst,'reload schema';
