-- Ephemeral GitHub CI database ONLY; no production project or credentials.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type public.controlled_document_status as enum('draft','pending','current','rejected','obsolete');
create type public.document_workflow_action as enum('created','submitted','approved','rejected');
create type public.document_access_role as enum('viewer','modifier','authorizer');
create table public.organizations(id uuid primary key,kind text not null,active boolean not null);
create table public.profiles(id uuid primary key,organization_id uuid references public.organizations,user_type text,status text);
create table public.processes(id text primary key,organization_id uuid references public.organizations,active boolean);
create table public.document_types(id text primary key);
create table public.controlled_documents(id uuid primary key default gen_random_uuid(),process_id text references public.processes,
 document_type_id text references public.document_types,code text unique not null,title text not null,organization_id uuid references public.organizations,
 owner_id uuid references public.profiles,created_by uuid references public.profiles,active boolean default true,deleted_at timestamptz,deleted_by uuid,deletion_reason text);
create table public.file_objects(id uuid primary key,bucket_id text,object_path text unique,original_name text,mime_type text,size_bytes bigint,
 uploaded_by uuid references public.profiles,resource_type text,resource_id uuid,module_id text,audience text,process_id text,category text,
 workspace_id uuid,deleted_at timestamptz,preview_path text);
create table storage.objects(bucket_id text,name text,owner_id text,primary key(bucket_id,name));
create table public.controlled_document_versions(id uuid primary key default gen_random_uuid(),document_id uuid references public.controlled_documents,
 revision integer not null check(revision>=0),status public.controlled_document_status not null default 'draft',file_id uuid references public.file_objects,
 file_name text not null,change_reason text not null,change_summary text,comments text,uploaded_by uuid references public.profiles,validator_id uuid,
 submitted_by uuid,submitted_at timestamptz,authorized_by uuid,authorized_at timestamptz,rejected_by uuid,rejected_at timestamptz,rejection_reason text,
 unique(document_id,revision));
create unique index controlled_document_current_version_idx on public.controlled_document_versions(document_id) where status='current';
create table public.document_lifecycle(document_id uuid primary key references public.controlled_documents,lifecycle_status text,is_deleted boolean,
 deleted_at timestamptz,deleted_by uuid,delete_reason text,restored_at timestamptz,restored_by uuid);
create table public.document_workflow_events(id uuid primary key default gen_random_uuid(),document_id uuid,version_id uuid,action public.document_workflow_action,actor_id uuid,comment text);
create table public.document_audit_log(id uuid primary key default gen_random_uuid(),document_id uuid,document_version_id uuid,event_type text,
 previous_state jsonb,new_state jsonb,reason text,performed_by uuid,performed_at timestamptz default now(),metadata jsonb);
create function public.is_administrator() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and user_type='administrator' and status='active') $$;
create function public.has_process_access(text) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_administrator() or exists(select 1 from public.profiles where id=auth.uid() and user_type='internal' and status='active') $$;
create function public.has_process_document_role(text,public.document_access_role) returns boolean language sql stable as $$ select public.is_administrator() $$;
create function public.has_permission(text,uuid,uuid,text,uuid,boolean,uuid) returns boolean language sql stable as $$ select false $$;
grant usage on schema public,auth,storage to authenticated,anon;
grant all on all tables in schema public,storage to authenticated;
alter table public.file_objects enable row level security;
create policy existing_file_read on public.file_objects for select to authenticated using(true);
alter table storage.objects enable row level security;
create policy existing_storage_read on storage.objects for select to authenticated using(true);
alter table public.controlled_document_versions enable row level security;
create policy existing_version_admin on public.controlled_document_versions for all to authenticated using(public.is_administrator()) with check(public.is_administrator());
insert into public.organizations values('00000000-0000-4000-8000-000000000001','internal',true),('00000000-0000-4000-8000-000000000002','internal',true);
insert into public.profiles values
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','administrator','active'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','internal','active'),
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','customer','active'),
 ('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','supplier','active'),
 ('10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002','administrator','active'),
 ('10000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','administrator','inactive');
insert into public.processes values('P-TEST','00000000-0000-4000-8000-000000000001',true),('P-OTHER','00000000-0000-4000-8000-000000000002',true);
insert into public.document_types values('visual-aid'),('manual');
insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,uploaded_by,resource_type,module_id,audience,process_id,category)
 select ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'integraq-private',
 '10000000-0000-4000-8000-000000000001/documents/file-'||i||'.pdf','file-'||i||'.pdf','application/pdf',100,
 '10000000-0000-4000-8000-000000000001','controlled_document','documents','internal','P-TEST','visual-aid' from generate_series(1,12) i;
insert into storage.objects select bucket_id,object_path,uploaded_by::text from public.file_objects;
-- Assertions are invoker functions, so tests exercise the actual authenticated role.
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function public.test_denied(command text,expected text,label text) returns void language plpgsql as $$ declare result text; begin
 begin execute command; exception when others then result:=sqlerrm; end;
 if result is null or position(expected in result)=0 then raise exception 'FAIL: %; actual=%',label,result; end if;
 raise notice 'PASS: %',label; end $$;
