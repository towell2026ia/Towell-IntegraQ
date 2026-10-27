-- STB-02: schema/guards/RPCs only. Never changes existing documents or binaries.
begin;
alter table public.controlled_documents add column if not exists workspace_mode text check(workspace_mode in ('production','demo'));
alter table public.file_objects add column if not exists workspace_mode text check(workspace_mode in ('production','demo'));
alter table public.document_folders add column if not exists workspace_mode text check(workspace_mode in ('production','demo'));
alter table public.document_upload_batches add column if not exists workspace_mode text check(workspace_mode in ('production','demo'));

create function public.document_actor_scope(p_org uuid,p_mode text,p_creator uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles a join auth.users u on u.id=a.id
    where a.id=auth.uid() and a.status='active' and a.user_type in ('administrator','internal')
    and a.organization_id=p_org
    and a.workspace_mode=coalesce(p_mode,(select c.workspace_mode from public.profiles c where c.id=p_creator),'production')
    and a.workspace_mode=coalesce(u.raw_app_meta_data->>'workspace_mode','production'))
$$;
create function public.require_document_administrator() returns public.profiles
language plpgsql stable security definer set search_path='' as $$
declare a public.profiles;
begin
  select p.* into a from public.profiles p where p.id=auth.uid() and p.status='active' and p.user_type='administrator';
  if a.id is null or not public.document_actor_scope(a.organization_id,a.workspace_mode,a.id) then raise exception using errcode='42501',message='DOCUMENT_ADMIN_SCOPE_REQUIRED';end if;
  return a;
end;$$;
revoke all on function public.require_document_administrator() from public,anon,authenticated;

create function public.document_scope_visible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.controlled_documents d join public.processes p on p.id=d.process_id
 where d.id=p_id and public.document_actor_scope(coalesce(d.organization_id,p.organization_id),d.workspace_mode,d.created_by)
 and (d.deleted_at is null or public.is_administrator()))
$$;

-- Legacy rows stay untouched. NULL mode is resolved from their creator on access.
-- A trigger checks conflicts with legacy rows too; the index protects concurrent
-- new rows. No code is renamed, no master is replaced, no lifecycle is backfilled.
alter table public.controlled_documents drop constraint controlled_documents_code_key;
create unique index controlled_documents_live_scope_code_idx on public.controlled_documents(
 coalesce(organization_id::text,'legacy'),coalesce(workspace_mode,'legacy'),upper(btrim(code))) where deleted_at is null;

create function public.guard_document_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_org uuid;v_mode text;a public.profiles;
begin
 select p.organization_id into v_org from public.processes p where p.id=new.process_id;
 if v_org is null then raise exception using errcode='23514',message='DOCUMENT_PROCESS_SCOPE_REQUIRED';end if;
 if tg_op='INSERT' then
   new.organization_id:=v_org;
   new.workspace_mode:=coalesce(new.workspace_mode,(select p.workspace_mode from public.profiles p where p.id=new.created_by),'production');
 elsif (new.organization_id,new.workspace_mode,new.created_by) is distinct from (old.organization_id,old.workspace_mode,old.created_by) then
   raise exception using errcode='42501',message='DOCUMENT_SCOPE_IMMUTABLE';
 end if;
 v_mode:=coalesce(new.workspace_mode,(select p.workspace_mode from public.profiles p where p.id=new.created_by),'production');
 if auth.uid() is not null then
   a:=public.require_document_administrator();
   if not public.document_actor_scope(v_org,v_mode,new.created_by) then raise exception using errcode='42501',message='DOCUMENT_SCOPE_FORBIDDEN';end if;
 end if;
 if nullif(btrim(new.code),'') is null then raise exception using errcode='22023',message='DOCUMENT_CODE_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('document-code:'||v_org::text||':'||upper(btrim(new.code)),0));
 if new.deleted_at is null and exists(
   select 1 from public.controlled_documents d join public.processes p on p.id=d.process_id left join public.profiles c on c.id=d.created_by
   where d.id<>new.id and d.deleted_at is null and coalesce(d.organization_id,p.organization_id)=v_org
   and coalesce(d.workspace_mode,c.workspace_mode,'production')=v_mode and upper(btrim(d.code))=upper(btrim(new.code))
 ) then raise exception using errcode='23505',message='DOCUMENT_ACTIVE_CODE_CONFLICT';end if;
 return new;
end;$$;
create trigger controlled_documents_scope_identity before insert or update on public.controlled_documents for each row execute function public.guard_document_identity();
create policy stb2_document_scope on public.controlled_documents as restrictive for all to authenticated
 using(public.document_scope_visible(id))
 with check(public.document_actor_scope(organization_id,workspace_mode,created_by));
create policy stb2_versions_scope on public.controlled_document_versions as restrictive for all to authenticated
 using(public.document_scope_visible(document_id)) with check(public.document_scope_visible(document_id));
create policy stb2_lifecycle_scope on public.document_lifecycle as restrictive for select to authenticated using(public.document_scope_visible(document_id));
alter view public.v_document_master_list set (security_invoker=true);
create policy stb2_workflow_scope on public.document_workflow_events as restrictive for all to authenticated using(public.document_scope_visible(document_id)) with check(public.document_scope_visible(document_id));
create policy stb2_document_process_scope on public.document_processes as restrictive for all to authenticated using(public.document_scope_visible(document_id)) with check(public.document_scope_visible(document_id));
create policy stb2_audit_scope on public.document_audit_log as restrictive for select to authenticated using(public.document_scope_visible(document_id));

create or replace function public.assert_document_permission(requested_permission text,requested_document_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare d public.controlled_documents;
begin
 select * into d from public.controlled_documents where id=requested_document_id;
 if d.id is null or not public.document_scope_visible(d.id) then raise exception using errcode='42501',message='DOCUMENT_SCOPE_FORBIDDEN';end if;
 if requested_permission in ('documents.edit','documents.version','documents.obsolete','documents.delete','documents.restore','documents.file.create','documents.file.edit') then
   perform public.require_document_administrator();
   if d.deleted_at is not null and requested_permission not in ('documents.restore','documents.delete') then raise exception using errcode='22023',message='DOCUMENT_IS_DELETED';end if;
 elsif not public.is_administrator() and not public.has_permission(requested_permission,null,null,d.process_id,null,false,null) then
   raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 return d.process_id;
end;$$;

create or replace function public.soft_delete_document(p_document_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare d public.controlled_documents;v_version uuid;
begin
 perform public.assert_document_permission('documents.delete',p_document_id);
 if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='REASON_REQUIRED';end if;
 select * into d from public.controlled_documents where id=p_document_id for update;
 if d.deleted_at is not null then return;end if;
 if exists(select 1 from public.home_institutional_items h where h.active and h.document_id=d.id) then raise exception using errcode='23503',message='DOCUMENT_ACTIVE_REFERENCE';end if;
 select v.id into v_version from public.controlled_document_versions v where v.document_id=d.id order by (v.status='current') desc,v.revision desc limit 1;
 update public.controlled_documents set deleted_at=clock_timestamp(),deleted_by=auth.uid(),deletion_reason=btrim(p_reason) where id=d.id;
 insert into public.document_lifecycle(document_id,lifecycle_status,is_deleted,deleted_at,deleted_by,delete_reason)
 values(d.id,'deleted',true,clock_timestamp(),auth.uid(),btrim(p_reason))
 on conflict(document_id) do update set lifecycle_status='deleted',is_deleted=true,deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,delete_reason=excluded.delete_reason;
 insert into public.document_audit_log(document_id,document_version_id,event_type,previous_state,new_state,reason,performed_by,metadata)
 values(d.id,v_version,'DOCUMENT_DELETED',to_jsonb(d),jsonb_build_object('deleted',true),btrim(p_reason),auth.uid(),jsonb_build_object('version_id',v_version));
end;$$;
create or replace function public.restore_document(p_document_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare d public.controlled_documents;l public.document_lifecycle;
begin
 perform public.assert_document_permission('documents.restore',p_document_id);
 select * into d from public.controlled_documents where id=p_document_id for update;
 if d.deleted_at is null then raise exception using errcode='22023',message='DOCUMENT_NOT_DELETED';end if;
 select * into l from public.document_lifecycle where document_id=d.id;
 -- The same identity trigger/index arbitrates restore vs create, atomically.
 update public.controlled_documents set deleted_at=null,deleted_by=null,deletion_reason=null where id=d.id;
 update public.document_lifecycle set lifecycle_status=case when obsoleted_at is null then 'active' else 'obsolete' end,is_deleted=false,restored_at=clock_timestamp(),restored_by=auth.uid(),deleted_at=null,deleted_by=null,delete_reason=null where document_id=d.id;
 insert into public.document_audit_log(document_id,event_type,previous_state,new_state,reason,performed_by)
 values(d.id,'DOCUMENT_RESTORED',to_jsonb(d),jsonb_build_object('deleted',false),'Restauración administrativa',auth.uid());
end;$$;

create function public.document_code_available(p_code text,p_process text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare a public.profiles:=public.require_document_administrator();
begin
 if not exists(select 1 from public.processes p where p.id=p_process and p.organization_id=a.organization_id) then raise exception using errcode='42501',message='DOCUMENT_SCOPE_FORBIDDEN';end if;
 return not exists(select 1 from public.controlled_documents d join public.processes p on p.id=d.process_id left join public.profiles c on c.id=d.created_by
 where coalesce(d.organization_id,p.organization_id)=a.organization_id and coalesce(d.workspace_mode,c.workspace_mode,'production')=a.workspace_mode
 and d.deleted_at is null and upper(btrim(d.code))=upper(btrim(p_code)));
end;$$;

create function public.register_controlled_file(p_document jsonb,p_file jsonb,p_existing uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.profiles:=public.require_document_administrator();v_doc uuid:=coalesce(p_existing,gen_random_uuid());v_file uuid:=gen_random_uuid();v_version uuid:=gen_random_uuid();v_process text;v_type text;v_owner uuid;
begin
 if p_existing is not null then
   perform public.assert_document_permission('documents.version',p_existing);
   select d.process_id,d.document_type_id into v_process,v_type from public.controlled_documents d where d.id=p_existing for update;
 else
   v_process:=p_document->>'process_id';v_type:=p_document->>'document_type_id';
 end if;
 if not exists(select 1 from public.processes p where p.id=v_process and p.organization_id=a.organization_id) then raise exception using errcode='42501',message='DOCUMENT_SCOPE_FORBIDDEN';end if;
 v_owner:=coalesce((p_document->>'owner_id')::uuid,a.id);
 if not exists(select 1 from public.profiles p where p.id=v_owner and p.organization_id=a.organization_id and p.workspace_mode=a.workspace_mode and p.status='active') then raise exception using errcode='42501',message='DOCUMENT_OWNER_SCOPE_INVALID';end if;
 if nullif(p_document->>'validator_id','') is not null and not exists(select 1 from public.profiles p where p.id=(p_document->>'validator_id')::uuid and p.organization_id=a.organization_id and p.workspace_mode=a.workspace_mode and p.status='active') then raise exception using errcode='42501',message='DOCUMENT_VALIDATOR_SCOPE_INVALID';end if;
 if p_file->>'object_path' not like a.id::text||'/documents/%' then raise exception using errcode='22023',message='DOCUMENT_FILE_PATH_INVALID';end if;
 if p_existing is null then
   insert into public.controlled_documents(id,organization_id,workspace_mode,process_id,document_type_id,code,title,owner_id,created_by)
   values(v_doc,a.organization_id,a.workspace_mode,v_process,v_type,upper(btrim(p_document->>'code')),p_document->>'title',v_owner,a.id);
 end if;
 insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,process_id,module_id,audience,resource_type,resource_id,resource_key,category,uploaded_by,workspace_mode)
 values(v_file,'integraq-private',p_file->>'object_path',p_file->>'original_name',p_file->>'mime_type',(p_file->>'size_bytes')::bigint,p_file->>'sha256',v_process,'documents','internal','controlled_document',v_doc,v_version::text,v_type,a.id,a.workspace_mode);
 if p_existing is null then
   insert into public.controlled_document_versions(id,document_id,revision,status,file_id,file_name,change_reason,uploaded_by,validator_id)
   values(v_version,v_doc,(p_document->>'revision')::integer,'draft',v_file,p_file->>'original_name','Carga pendiente de autorización',a.id,nullif(p_document->>'validator_id','')::uuid);
   perform public.submit_document_version(v_version);
 else
   perform public.create_document_version(v_doc,(p_document->>'revision')::integer,v_file,p_file->>'original_name',p_document->>'change_reason',p_document->>'change_summary',p_document->>'comments',v_version);
 end if;
 return jsonb_build_object('document_id',v_doc,'version_id',v_version,'file_id',v_file);
end;$$;

create table public.document_retention_events(
 id uuid primary key default gen_random_uuid(),file_id uuid not null references public.file_objects(id) on delete restrict,
 workspace_id uuid not null references public.organizations(id),workspace_mode text not null,
 action text not null,reason text,previous_state jsonb,new_state jsonb,
 performed_by uuid not null references public.profiles(id),performed_at timestamptz not null default now());
alter table public.document_retention_events enable row level security;
create policy document_retention_events_read on public.document_retention_events for select to authenticated using(public.is_administrator() and public.document_actor_scope(workspace_id,workspace_mode,performed_by));
revoke all on public.document_retention_events from public,anon,authenticated;
grant select on public.document_retention_events to authenticated;
create function public.reject_document_history_mutation() returns trigger language plpgsql as $$begin raise exception using errcode='42501',message='DOCUMENT_HISTORY_IMMUTABLE';end;$$;
create trigger document_retention_immutable before update or delete on public.document_retention_events for each row execute function public.reject_document_history_mutation();
create trigger document_audit_immutable before update or delete on public.document_audit_log for each row execute function public.reject_document_history_mutation();

create function public.guard_general_document_scope() returns trigger language plpgsql security definer set search_path='' as $$
declare v_creator uuid;v_org uuid;a public.profiles;
begin
 if tg_table_name='file_objects' then
   if new.resource_type<>'general_information_document' then return new;end if;
   v_creator:=new.uploaded_by;v_org:=new.workspace_id;
   if not exists(select 1 from public.document_folders f where f.id=new.folder_id and f.workspace_id=v_org and coalesce(f.workspace_mode,(select p.workspace_mode from public.profiles p where p.id=f.created_by),'production')=coalesce(new.workspace_mode,(select p.workspace_mode from public.profiles p where p.id=v_creator),'production')) then raise exception using errcode='42501',message='DOCUMENT_FOLDER_SCOPE_INVALID';end if;
 else v_creator:=new.created_by;v_org:=new.workspace_id;end if;
 if tg_op='INSERT' then new.workspace_mode:=coalesce(new.workspace_mode,(select p.workspace_mode from public.profiles p where p.id=v_creator),'production');
 elsif new.workspace_mode is distinct from old.workspace_mode then raise exception using errcode='42501',message='DOCUMENT_SCOPE_IMMUTABLE';end if;
 if auth.uid() is not null then
   a:=public.require_document_administrator();
   if not public.document_actor_scope(v_org,new.workspace_mode,v_creator) then raise exception using errcode='42501',message='DOCUMENT_SCOPE_FORBIDDEN';end if;
 end if;
 return new;
end;$$;
create trigger stb2_general_file_scope before insert or update on public.file_objects for each row execute function public.guard_general_document_scope();
create trigger stb2_general_folder_scope before insert or update on public.document_folders for each row execute function public.guard_general_document_scope();
create trigger stb2_general_batch_scope before insert or update on public.document_upload_batches for each row execute function public.guard_general_document_scope();
create policy stb2_folder_scope on public.document_folders as restrictive for all to authenticated using(public.document_actor_scope(workspace_id,workspace_mode,created_by)) with check(public.document_actor_scope(workspace_id,workspace_mode,created_by));
create policy stb2_batch_scope on public.document_upload_batches as restrictive for all to authenticated using(public.document_actor_scope(workspace_id,workspace_mode,created_by)) with check(public.document_actor_scope(workspace_id,workspace_mode,created_by));

create function public.document_file_scope(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.file_objects f where f.id=p_id and
 case when f.resource_type='general_information_document' then public.document_actor_scope(f.workspace_id,f.workspace_mode,f.uploaded_by)
 when f.resource_type='controlled_document' then
   case when f.resource_id is not null then public.document_scope_visible(f.resource_id)
   else public.document_actor_scope((select p.organization_id from public.processes p where p.id=f.process_id),f.workspace_mode,f.uploaded_by) end
 else true end)
$$;
create function public.guard_retained_document_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and not public.document_scope_visible(new.document_id) then raise exception using errcode='42501',message='DOCUMENT_SCOPE_FORBIDDEN';end if;
 if tg_op='UPDATE' and (new.document_id is distinct from old.document_id or (old.authorized_at is not null and (new.file_id,new.revision) is distinct from (old.file_id,old.revision))) then raise exception using errcode='42501',message='DOCUMENT_VERSION_RETAINED';end if;
 if exists(select 1 from public.controlled_documents d where d.id=new.document_id and d.deleted_at is not null) then raise exception using errcode='22023',message='DOCUMENT_IS_DELETED';end if;
 if auth.uid() is not null and new.file_id is not null and not public.document_file_scope(new.file_id) then raise exception using errcode='42501',message='DOCUMENT_FILE_SCOPE_INVALID';end if;
 return new;
end;$$;
create trigger stb2_retained_document_version before insert or update on public.controlled_document_versions for each row execute function public.guard_retained_document_version();
create function public.guard_document_binary_identity() returns trigger language plpgsql as $$
begin
 if old.resource_type in ('general_information_document','controlled_document') and (new.bucket_id,new.object_path,new.original_name,new.size_bytes,new.sha256) is distinct from (old.bucket_id,old.object_path,old.original_name,old.size_bytes,old.sha256) then raise exception using errcode='42501',message='DOCUMENT_BINARY_IMMUTABLE';end if;
 return new;
end;$$;
create trigger stb2_document_binary_identity before update on public.file_objects for each row execute function public.guard_document_binary_identity();

create policy stb2_file_scope on public.file_objects as restrictive for all to authenticated using(public.document_file_scope(id))
 with check(resource_type not in ('general_information_document','controlled_document') or
  public.document_actor_scope(coalesce(workspace_id,(select p.organization_id from public.processes p where p.id=public.file_objects.process_id)),workspace_mode,uploaded_by));
create function public.document_storage_scope(p_bucket text,p_path text,p_deleting boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.file_objects f where f.bucket_id=p_bucket and (f.object_path=p_path or f.preview_path=p_path) and f.resource_type in ('controlled_document','general_information_document'))
 or (not p_deleting and exists(select 1 from public.file_objects f where f.bucket_id=p_bucket and (f.object_path=p_path or f.preview_path=p_path) and public.document_file_scope(f.id) and (f.deleted_at is null or public.is_administrator())))
$$;
create policy stb2_storage_document_scope on storage.objects as restrictive for select to authenticated using(public.document_storage_scope(bucket_id,name,false));
create policy stb2_storage_document_retention on storage.objects as restrictive for delete to authenticated using(public.document_storage_scope(bucket_id,name,true));
create policy stb2_file_retention on public.file_objects as restrictive for delete to authenticated using(resource_type not in ('controlled_document','general_information_document'));

create function public.general_document_lifecycle(p_id uuid,p_action text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare a public.profiles:=public.require_document_administrator();f public.file_objects;
begin
 select * into f from public.file_objects where id=p_id and resource_type='general_information_document' for update;
 if f.id is null or not public.document_actor_scope(f.workspace_id,f.workspace_mode,f.uploaded_by) then raise exception using errcode='42501',message='DOCUMENT_SCOPE_FORBIDDEN';end if;
 if p_action='delete' then
   if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='REASON_REQUIRED';end if;
   if f.deleted_at is not null then return;end if;
   update public.file_objects set deleted_at=clock_timestamp(),deleted_by=a.id,deletion_reason=btrim(p_reason),is_current=false,updated_by=a.id where id=f.id;
 elsif p_action='restore' then
   if f.deleted_at is null then raise exception using errcode='22023',message='DOCUMENT_NOT_DELETED';end if;
   if not exists(select 1 from public.document_folders d where d.id=f.folder_id and d.deleted_at is null and public.document_actor_scope(d.workspace_id,d.workspace_mode,d.created_by)) then raise exception using errcode='23503',message='DOCUMENT_FOLDER_UNAVAILABLE';end if;
   if exists(select 1 from public.file_objects other where other.id<>f.id and other.resource_type=f.resource_type and coalesce(other.resource_key,other.resource_id::text)=coalesce(f.resource_key,f.resource_id::text) and other.is_current and other.deleted_at is null) then raise exception using errcode='23505',message='DOCUMENT_ACTIVE_CODE_CONFLICT';end if;
   update public.file_objects set deleted_at=null,deleted_by=null,deletion_reason=null,is_current=true,updated_by=a.id where id=f.id;
 else raise exception using errcode='22023',message='DOCUMENT_ACTION_INVALID';end if;
 insert into public.document_retention_events(file_id,workspace_id,workspace_mode,action,reason,previous_state,new_state,performed_by)
 select f.id,f.workspace_id,coalesce(f.workspace_mode,a.workspace_mode),p_action,coalesce(p_reason,'Restauración administrativa'),to_jsonb(f),to_jsonb(n),a.id from public.file_objects n where n.id=f.id;
end;$$;

create function public.publish_general_document(p_file jsonb,p_replaces uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.profiles:=public.require_document_administrator();old_file public.file_objects;v_id uuid:=(p_file->>'id')::uuid;v_folder uuid:=(p_file->>'folder_id')::uuid;v_key text;
begin
 if not exists(select 1 from public.document_folders f where f.id=v_folder and f.deleted_at is null and public.document_actor_scope(f.workspace_id,f.workspace_mode,f.created_by)) then raise exception using errcode='42501',message='DOCUMENT_FOLDER_UNAVAILABLE';end if;
 if p_file->>'object_path' not like a.organization_id::text||'/information-general/'||v_folder::text||'/'||v_id::text||'/%' then raise exception using errcode='22023',message='DOCUMENT_FILE_PATH_INVALID';end if;
 if nullif(p_file->>'batch_id','') is not null and not exists(select 1 from public.document_upload_batches b where b.id=(p_file->>'batch_id')::uuid and public.document_actor_scope(b.workspace_id,b.workspace_mode,b.created_by)) then raise exception using errcode='42501',message='DOCUMENT_BATCH_SCOPE_INVALID';end if;
 if p_replaces is not null then
   select * into old_file from public.file_objects f where f.id=p_replaces and f.resource_type='general_information_document' and f.deleted_at is null and f.is_current for update;
   if old_file.id is null or not public.document_actor_scope(old_file.workspace_id,old_file.workspace_mode,old_file.uploaded_by) then raise exception using errcode='22023',message='DOCUMENT_REPLACEMENT_STALE';end if;
   update public.file_objects set is_current=false,updated_by=a.id where id=old_file.id;
 end if;
 v_key:=coalesce(old_file.resource_key,old_file.resource_id::text,p_file->>'resource_key',v_id::text);
 insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,module_id,audience,resource_type,resource_id,resource_key,category,uploaded_by,workspace_id,workspace_mode,folder_id,batch_id,version,is_current,replaces_file_id,preview_status,display_name,reference_type,external_origin,validity_status,valid_from,valid_until,description,observations,updated_by)
 values(v_id,'integraq-private',p_file->>'object_path',p_file->>'original_name',p_file->>'mime_type',(p_file->>'size_bytes')::bigint,p_file->>'sha256','documents','internal','general_information_document',v_id,v_key,'information-general',a.id,a.organization_id,a.workspace_mode,v_folder,(p_file->>'batch_id')::uuid,coalesce(old_file.version,0)+1,true,old_file.id,p_file->>'preview_status',p_file->>'display_name',p_file->>'reference_type',p_file->>'external_origin',p_file->>'validity_status',(p_file->>'valid_from')::date,(p_file->>'valid_until')::date,p_file->>'description',p_file->>'observations',a.id);
 insert into public.document_retention_events(file_id,workspace_id,workspace_mode,action,reason,previous_state,new_state,performed_by)
 select v_id,a.organization_id,a.workspace_mode,case when old_file.id is null then 'create' else 'replace' end,'Publicación documental',to_jsonb(old_file),to_jsonb(n),a.id from public.file_objects n where n.id=v_id;
 return v_id;
end;$$;

create or replace function public.audit_general_information_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare event_action text;
declare workspace uuid;
declare audit_actor uuid;
declare resource text;
declare resource_key text;
declare details jsonb;
begin
  if tg_table_name = 'document_folders' then
    resource := 'document_folder';
    if tg_op = 'INSERT' then
      workspace := new.workspace_id;
      audit_actor := coalesce(auth.uid(), new.updated_by, new.created_by);
      resource_key := new.id::text;
      event_action := 'CREATE_FOLDER';
      details := jsonb_build_object('name', new.name, 'parent_folder_id', new.parent_folder_id);
    else
      workspace := coalesce(new.workspace_id, old.workspace_id);
      audit_actor := coalesce(auth.uid(), new.updated_by, new.created_by, old.updated_by, old.created_by);
      resource_key := coalesce(new.id, old.id)::text;
      event_action := case
        when old.deleted_at is null and new.deleted_at is not null then 'DELETE_FOLDER'
        when old.deleted_at is not null and new.deleted_at is null then 'RESTORE_FOLDER'
        when old.parent_folder_id is distinct from new.parent_folder_id then 'MOVE_FOLDER'
        when old.name is distinct from new.name then 'RENAME_FOLDER'
        when old.archived_at is distinct from new.archived_at then 'ARCHIVE_FOLDER'
        else 'UPDATE_FOLDER'
      end;
      details := jsonb_build_object('name', new.name, 'parent_folder_id', new.parent_folder_id);
    end if;
  else
    resource := 'general_information_document';
    if tg_op = 'INSERT' then
      if new.resource_type <> 'general_information_document' then return new; end if;
      workspace := new.workspace_id;
      audit_actor := coalesce(auth.uid(), new.updated_by, new.uploaded_by);
      resource_key := new.id::text;
      event_action := case when new.replaces_file_id is not null then 'REPLACE_DOCUMENT' else 'UPLOAD_DOCUMENT' end;
      details := jsonb_build_object('name', new.display_name, 'folder_id', new.folder_id, 'batch_id', new.batch_id);
    else
      if coalesce(new.resource_type, old.resource_type) <> 'general_information_document' then return new; end if;
      workspace := coalesce(new.workspace_id, old.workspace_id);
      audit_actor := coalesce(auth.uid(), new.updated_by, new.uploaded_by, old.updated_by, old.uploaded_by);
      resource_key := coalesce(new.id, old.id)::text;
      event_action := case
        when old.deleted_at is null and new.deleted_at is not null then 'DELETE_DOCUMENT'
        when old.deleted_at is not null and new.deleted_at is null then 'RESTORE_DOCUMENT'
        when old.folder_id is distinct from new.folder_id then 'MOVE_DOCUMENT'
        when old.reference_type is distinct from new.reference_type then 'CHANGE_REFERENCE_TYPE'
        when old.validity_status is distinct from new.validity_status then 'CHANGE_VALIDITY'
        else 'UPDATE_DOCUMENT'
      end;
      details := jsonb_build_object('name', new.display_name, 'folder_id', new.folder_id, 'batch_id', new.batch_id);
    end if;
  end if;

  insert into public.audit_log(actor_id, action, resource_type, resource_id, metadata)
  values (audit_actor, event_action, resource, resource_key, details || jsonb_build_object('workspace_id', workspace, 'workspace_mode', public.current_workspace_mode(), 'reason', case when tg_op='UPDATE' then new.deletion_reason else null end));
  return new;
end;
$$;


-- Physical deletion of these records/binaries is never an administrative action.
revoke delete on public.controlled_documents,public.controlled_document_versions from authenticated;
revoke all on function public.document_storage_scope(text,text,boolean),public.document_actor_scope(uuid,text,uuid),public.document_scope_visible(uuid),public.document_file_scope(uuid),public.document_code_available(text,text),public.register_controlled_file(jsonb,jsonb,uuid),public.general_document_lifecycle(uuid,text,text),public.publish_general_document(jsonb,uuid) from public,anon;
grant execute on function public.document_storage_scope(text,text,boolean),public.document_actor_scope(uuid,text,uuid),public.document_scope_visible(uuid),public.document_file_scope(uuid),public.document_code_available(text,text),public.register_controlled_file(jsonb,jsonb,uuid),public.general_document_lifecycle(uuid,text,text),public.publish_general_document(jsonb,uuid) to authenticated;
commit;
