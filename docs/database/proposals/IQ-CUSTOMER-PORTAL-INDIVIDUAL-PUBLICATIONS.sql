-- Propuesta local. No ejecutar sin revisión/autorización y validación aislada.
-- Publicaciones por cliente; no altera documentos ni relaciones existentes.
begin;

create table if not exists public.customer_portal_document_publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.organizations(id) on delete restrict,
  customer_id uuid not null references public.organizations(id) on delete restrict,
  document_key uuid not null default gen_random_uuid(),
  previous_publication_id uuid references public.customer_portal_document_publications(id) on delete restrict,
  file_id uuid references public.file_objects(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) between 1 and 200),
  description text,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','published','withdrawn','superseded')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_by uuid references public.profiles(id) on delete restrict,
  published_at timestamptz,
  withdrawn_by uuid references public.profiles(id) on delete restrict,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  constraint customer_portal_publication_scope check (customer_id <> workspace_id),
  constraint customer_portal_publication_state check (
    (status <> 'published' or (published_by is not null and published_at is not null and file_id is not null)) and
    (status <> 'withdrawn' or (withdrawn_by is not null and withdrawn_at is not null and length(trim(coalesce(withdrawal_reason,''))) > 0))
  ),
  constraint customer_portal_publication_file_unique unique(file_id)
);
create unique index if not exists customer_portal_document_version_idx on public.customer_portal_document_publications(document_key,version);
create index if not exists customer_portal_published_idx
  on public.customer_portal_document_publications(workspace_id,customer_id,published_at desc)
  where status='published';

create table if not exists public.customer_portal_document_events (
  id bigint generated always as identity primary key,
  publication_id uuid not null references public.customer_portal_document_publications(id) on delete restrict,
  workspace_id uuid not null references public.organizations(id) on delete restrict,
  customer_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check(action in ('draft_created','published','withdrawn','superseded','accessed')),
  reason text,
  before_value jsonb,
  after_value jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists customer_portal_document_events_idx on public.customer_portal_document_events(publication_id,created_at desc);

-- Una sola versión publicada por documento y empresa.
create unique index if not exists customer_portal_one_published_version
  on public.customer_portal_document_publications(workspace_id, customer_id, document_key)
  where status = 'published';

alter table public.customer_portal_document_publications enable row level security;
alter table public.customer_portal_document_events enable row level security;
revoke all on public.customer_portal_document_publications, public.customer_portal_document_events
  from public, anon, authenticated;
grant select on public.customer_portal_document_publications, public.customer_portal_document_events to service_role;
grant insert on public.customer_portal_document_events to service_role;

-- El servidor autoriza cada listado y firma. Las sesiones de navegador conservan
-- sus políticas existentes para los restantes tipos y rutas.
drop policy if exists iq_u01_document_file_server on public.file_objects;
create policy iq_u01_document_file_server on public.file_objects
  as restrictive for all to public
  using (resource_type is distinct from 'customer_portal_document')
  with check (resource_type is distinct from 'customer_portal_document');

drop policy if exists iq_u01_document_storage_server on storage.objects;
create policy iq_u01_document_storage_server on storage.objects
  as restrictive for all to public
  using (bucket_id <> 'integraq-private' or name not like 'customer-portal/%')
  with check (bucket_id <> 'integraq-private' or name not like 'customer-portal/%');

-- Restrict internal Information Documentada metadata from external JWTs, regardless of permissive policies.
drop policy if exists iq_customer_portal_internal_document_metadata on public.file_objects;
create policy iq_customer_portal_internal_document_metadata on public.file_objects
  as restrictive for select to authenticated using (
    resource_type is distinct from 'general_information_document'
    or exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'
      and p.user_type in ('administrator','internal') and p.organization_id=file_objects.workspace_id)
  );
drop policy if exists iq_customer_portal_internal_folder_metadata on public.document_folders;
create policy iq_customer_portal_internal_folder_metadata on public.document_folders
  as restrictive for select to authenticated using (
    exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active'
      and p.user_type in ('administrator','internal') and p.organization_id=document_folders.workspace_id)
  );

-- Para la biblioteca interna, conservar las políticas permisivas vigentes y
-- exigir identidad interna del espacio también en la lectura directa de Storage.
drop policy if exists iq_u01_internal_document_storage on storage.objects;
create policy iq_u01_internal_document_storage on storage.objects
  as restrictive for select to public using (
    bucket_id <> 'integraq-private' or split_part(name, '/', 2) <> 'information-general'
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'
        and p.user_type in ('administrator','internal')
        and p.organization_id::text = split_part(storage.objects.name,'/',1)
    )
  );

create or replace function public.iq_customer_portal_document_record(
 p_actor_id uuid,p_workspace_id uuid,p_customer_id uuid,p_object_path text,p_original_name text,
 p_display_name text,p_description text,p_size_bytes bigint,p_sha256 text,p_mime_type text,p_previous_publication_id uuid default null
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare actor public.profiles%rowtype; customer public.organizations%rowtype; publication public.customer_portal_document_publications%rowtype; parent public.customer_portal_document_publications%rowtype; v_file_id uuid; v_document_key uuid; v_version integer;
begin
 select * into actor from public.profiles where id=p_actor_id and status='active' and user_type='administrator' and organization_id=p_workspace_id;
 if not found then raise exception 'CUSTOMER_PORTAL_ADMIN_REQUIRED'; end if;
 select * into customer from public.organizations where id=p_customer_id and kind='customer' and active and owning_organization_id=p_workspace_id;
 if not found then raise exception 'CUSTOMER_PORTAL_CUSTOMER_SCOPE'; end if;
 v_document_key:=gen_random_uuid(); v_version:=1;
 if p_previous_publication_id is not null then
   select * into parent from public.customer_portal_document_publications where id=p_previous_publication_id and workspace_id=p_workspace_id and customer_id=p_customer_id and status='published' for update;
   if not found then raise exception 'CUSTOMER_PORTAL_VERSION_PARENT_INVALID'; end if;
   v_document_key:=parent.document_key; v_version:=parent.version+1;
 end if;
 if p_object_path !~ ('^customer-portal/'||p_workspace_id::text||'/'||p_customer_id::text||'/[0-9a-f-]+[.]pdf$')
    or p_mime_type<>'application/pdf' or p_size_bytes<=0 or p_size_bytes>26214400 or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'CUSTOMER_PORTAL_FILE_INVALID'; end if;
 insert into public.customer_portal_document_publications(workspace_id,customer_id,document_key,previous_publication_id,display_name,description,version,created_by)
 values(p_workspace_id,p_customer_id,v_document_key,p_previous_publication_id,p_display_name,p_description,v_version,p_actor_id) returning * into publication;
 insert into public.file_objects(bucket_id,object_path,original_name,mime_type,size_bytes,sha256,workspace_id,external_organization_id,audience,resource_type,resource_id,uploaded_by,display_name)
 values('integraq-private',p_object_path,p_original_name,p_mime_type,p_size_bytes,p_sha256,p_workspace_id,p_customer_id,'customer','customer_portal_document',publication.id,p_actor_id,p_display_name)
 returning id into v_file_id;
 update public.customer_portal_document_publications set file_id=v_file_id where id=publication.id returning * into publication;
 insert into public.customer_portal_document_events(publication_id,workspace_id,customer_id,actor_id,action,after_value)
 values(publication.id,p_workspace_id,p_customer_id,p_actor_id,'draft_created',to_jsonb(publication));
 return to_jsonb(publication);
end $fn$;

create or replace function public.iq_customer_portal_document_transition(
 p_actor_id uuid,p_workspace_id uuid,p_publication_id uuid,p_action text,p_reason text,p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare actor public.profiles%rowtype; item public.customer_portal_document_publications%rowtype; old_item public.customer_portal_document_publications%rowtype; before_value jsonb; old_before jsonb;
begin
 select * into actor from public.profiles where id=p_actor_id and status='active' and user_type='administrator' and organization_id=p_workspace_id;
 if not found then raise exception 'CUSTOMER_PORTAL_ADMIN_REQUIRED'; end if;
 select * into item from public.customer_portal_document_publications where id=p_publication_id and workspace_id=p_workspace_id for update;
 if not found then raise exception 'CUSTOMER_PORTAL_PUBLICATION_NOT_FOUND'; end if;
 if item.revision is distinct from p_expected_revision then raise exception 'CUSTOMER_PORTAL_REVISION_CONFLICT'; end if;
 if p_action='publish' and item.status='draft' then
   if not exists(select 1 from public.organizations where id=item.customer_id and kind='customer' and active and owning_organization_id=item.workspace_id) then raise exception 'CUSTOMER_PORTAL_CUSTOMER_SCOPE'; end if;
   for old_item in select * from public.customer_portal_document_publications where workspace_id=item.workspace_id and customer_id=item.customer_id and document_key=item.document_key and status='published' and id<>item.id for update loop
     old_before:=to_jsonb(old_item);
     update public.customer_portal_document_publications set status='superseded',revision=revision+1 where id=old_item.id returning * into old_item;
     insert into public.customer_portal_document_events(publication_id,workspace_id,customer_id,actor_id,action,reason,before_value,after_value)
       values(old_item.id,p_workspace_id,old_item.customer_id,p_actor_id,'superseded','Sustituido por una versión posterior',old_before,to_jsonb(old_item));
   end loop;
   before_value:=to_jsonb(item); update public.customer_portal_document_publications set status='published',published_by=p_actor_id,published_at=now(),revision=revision+1 where id=item.id returning * into item;
 elsif p_action='withdraw' and item.status='published' and length(trim(coalesce(p_reason,'')))>0 then
   before_value:=to_jsonb(item); update public.customer_portal_document_publications set status='withdrawn',withdrawn_by=p_actor_id,withdrawn_at=now(),withdrawal_reason=trim(p_reason),revision=revision+1 where id=item.id returning * into item;
 else raise exception 'CUSTOMER_PORTAL_TRANSITION_INVALID'; end if;
 insert into public.customer_portal_document_events(publication_id,workspace_id,customer_id,actor_id,action,reason,before_value,after_value)
 values(item.id,p_workspace_id,item.customer_id,p_actor_id,item.status,p_reason,before_value,to_jsonb(item));
 return to_jsonb(item);
end $fn$;

revoke all on function public.iq_customer_portal_document_record(uuid,uuid,uuid,text,text,text,text,bigint,text,text,uuid) from public,anon,authenticated;
revoke all on function public.iq_customer_portal_document_transition(uuid,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.iq_customer_portal_document_record(uuid,uuid,uuid,text,text,text,text,bigint,text,text,uuid) to service_role;
grant execute on function public.iq_customer_portal_document_transition(uuid,uuid,uuid,text,text,integer) to service_role;

-- Restringir las nuevas publicaciones de certificados sin modificar filas históricas.
create or replace function public.iq_u01_certification_recipient_guard()
returns trigger language plpgsql set search_path = '' as $guard$
begin
  if new.customer_visible and (
    new.external_organization_id is null or new.published_at is null or new.published_by is null
    or not exists (
      select 1 from public.organizations customer
      where customer.id = new.external_organization_id and customer.active
        and customer.kind = 'customer' and customer.owning_organization_id = new.workspace_id
    )
  ) then
    raise exception 'CERTIFICATION_RECIPIENT_REQUIRED';
  end if;
  return new;
end;
$guard$;
revoke all on function public.iq_u01_certification_recipient_guard() from public, anon, authenticated;
drop trigger if exists iq_u01_certification_recipient on public.certifications;
create trigger iq_u01_certification_recipient
  before insert or update of customer_visible, external_organization_id, workspace_id, published_at, published_by
  on public.certifications for each row execute function public.iq_u01_certification_recipient_guard();

-- Assign the first recipient only on an explicit save of an existing private draft.
-- The existing save RPC checks the administrator, ownership, revision and fields.
create or replace function public.iq_u01_save_certification_recipient(
  p_actor_id uuid, p_workspace_id uuid, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $assign$
declare
  target uuid := (p_payload->>'customerId')::uuid;
  cert_id uuid := (p_payload->>'id')::uuid;
  original public.certifications%rowtype;
  saved public.certifications%rowtype;
begin
  if current_user <> 'service_role' then raise exception using errcode='42501', message='SERVICE_COMMAND_ONLY'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(cert_id::text,0));
  select * into original from public.certifications where id=cert_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'CERTIFICATION_NOT_FOUND'; end if;
  if original.revision is distinct from (p_payload->>'revision')::integer then raise exception 'CERTIFICATION_CONCURRENT_EDIT'; end if;
  if not original.active or original.customer_visible or original.external_organization_id is not null then
    raise exception 'CERTIFICATION_CUSTOMER_IMMUTABLE';
  end if;
  perform 1 from public.organizations where id=target and kind='customer' and active
    and owning_organization_id=p_workspace_id for share;
  if not found then raise exception using errcode='42501', message='CUSTOMER_SCOPE_DENIED'; end if;
  perform public.iq_certification_command(p_actor_id,p_workspace_id,'save',p_payload - 'customerId');
  update public.certifications set external_organization_id=target where id=cert_id returning * into saved;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,previous_value,new_value)
    values(p_actor_id,p_workspace_id,'customers','certification.recipient_assigned','customer_certification',cert_id,
           jsonb_build_object('external_organization_id',original.external_organization_id),
           jsonb_build_object('external_organization_id',target));
  return jsonb_build_object('certification',to_jsonb(saved),'fileId',null);
end;
$assign$;
revoke all on function public.iq_u01_save_certification_recipient(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.iq_u01_save_certification_recipient(uuid,uuid,jsonb) to service_role;

-- Versioned read-only probe, installed atomically with the contract.
create or replace function public.iq_u01_publication_ready_v2()
returns boolean language sql stable security invoker set search_path='' as $ready$
  select current_user = 'service_role'
    and to_regclass('public.customer_portal_document_publications') is not null
    and to_regclass('public.customer_portal_document_events') is not null
    and has_function_privilege(current_user,'public.iq_customer_portal_document_record(uuid,uuid,uuid,text,text,text,text,bigint,text,text,uuid)','execute')
    and has_function_privilege(current_user,'public.iq_customer_portal_document_transition(uuid,uuid,uuid,text,text,integer)','execute')
    and exists (select 1 from pg_catalog.pg_trigger where tgrelid='public.certifications'::regclass
                and tgname='iq_u01_certification_recipient' and tgenabled in ('O','A'));
$ready$;
revoke all on function public.iq_u01_publication_ready_v2() from public,anon,authenticated;
grant execute on function public.iq_u01_publication_ready_v2() to service_role;

commit;
