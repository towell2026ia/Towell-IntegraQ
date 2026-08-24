-- IntegraQ: permisos finos, funciones de acceso y almacenamiento privado.
-- Requiere 202608230001_identity_and_access.sql.

create type public.module_permission_action as enum (
  'view',
  'create',
  'update',
  'submit',
  'review',
  'approve',
  'close',
  'reopen',
  'export',
  'manage'
);

create type public.file_audience as enum (
  'internal',
  'customer',
  'supplier',
  'shared'
);

alter table public.organizations
  add column category text,
  add column contact_name text,
  add column contact_email text,
  add column metadata jsonb not null default '{}'::jsonb;

alter table public.processes
  add column source_label text,
  add column representation text,
  add column scope text not null default 'pending'
    check (scope in ('included', 'reference', 'integration', 'excluded', 'pending')),
  add column validation_status text not null default 'draft'
    check (validation_status in ('draft', 'validated', 'approved')),
  add column metromap_data jsonb not null default '{}'::jsonb;

create table public.position_module_action_permissions (
  position_id text not null references public.positions(id) on delete cascade,
  module_id text not null references public.workspace_modules(id) on delete cascade,
  action public.module_permission_action not null,
  primary key (position_id, module_id, action)
);

create table public.user_module_action_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_id text not null references public.workspace_modules(id) on delete cascade,
  action public.module_permission_action not null,
  source public.permission_source not null default 'direct',
  inherited_from_position_id text references public.positions(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, module_id, action)
);

create table public.file_objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null default 'integraq-private',
  object_path text not null unique,
  original_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 text,
  process_id text references public.processes(id) on delete restrict,
  module_id text references public.workspace_modules(id) on delete restrict,
  external_organization_id uuid references public.organizations(id) on delete restrict,
  audience public.file_audience not null default 'internal',
  resource_type text not null,
  resource_id uuid,
  category text,
  uploaded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_file_scope check (
    audience = 'internal' or external_organization_id is not null
  )
);

create index file_objects_resource_idx
  on public.file_objects(resource_type, resource_id);
create index file_objects_process_idx on public.file_objects(process_id);
create index file_objects_module_idx on public.file_objects(module_id);
create index file_objects_external_org_idx
  on public.file_objects(external_organization_id);

create trigger file_objects_set_updated_at
before update on public.file_objects
for each row execute function public.set_updated_at();

create or replace function public.current_user_type()
returns public.app_user_type
language sql
stable
security definer
set search_path = ''
as $$
  select user_type
  from public.profiles
  where id = auth.uid() and status = 'active';
$$;

create or replace function public.document_role_rank(
  requested_role public.document_access_role
)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case requested_role
    when 'viewer' then 1
    when 'modifier' then 2
    when 'authorizer' then 3
  end::smallint;
$$;

create or replace function public.has_process_access(requested_process_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_administrator() or exists (
    select 1
    from public.user_process_permissions
    where user_id = auth.uid()
      and process_id = requested_process_id
  );
$$;

create or replace function public.has_process_document_role(
  requested_process_id text,
  required_role public.document_access_role
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_administrator() or exists (
    select 1
    from public.user_process_permissions
    where user_id = auth.uid()
      and process_id = requested_process_id
      and public.document_role_rank(document_role) >=
        public.document_role_rank(required_role)
  );
$$;

create or replace function public.has_module_permission(
  requested_module_id text,
  requested_action public.module_permission_action default 'view'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_administrator()
    or (
      requested_action = 'view'
      and exists (
        select 1 from public.user_module_permissions
        where user_id = auth.uid()
          and module_id = requested_module_id
          and can_view
      )
    )
    or (
      requested_action = 'manage'
      and exists (
        select 1 from public.user_module_permissions
        where user_id = auth.uid()
          and module_id = requested_module_id
          and can_manage
      )
    )
    or exists (
      select 1 from public.user_module_action_permissions
      where user_id = auth.uid()
        and module_id = requested_module_id
        and action = requested_action
    );
$$;

create or replace function public.has_external_organization_scope(
  requested_kind public.organization_kind,
  requested_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and external_party_kind = requested_kind
      and external_party_id = requested_organization_id
  );
$$;

-- Conserva permisos directos y vuelve a generar únicamente los heredados.
create or replace function public.sync_user_access_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_process_permissions
  where user_id = new.id and source in ('position', 'system');
  delete from public.user_module_permissions
  where user_id = new.id and source in ('position', 'system');
  delete from public.user_module_action_permissions
  where user_id = new.id and source in ('position', 'system');

  if new.status = 'active' and new.user_type = 'internal' and new.position_id is not null then
    insert into public.user_process_permissions (
      user_id, process_id, document_role, source, inherited_from_position_id
    )
    select new.id, process_id, document_role, 'position', new.position_id
    from public.position_process_permissions
    where position_id = new.position_id
    on conflict do nothing;

    insert into public.user_module_permissions (
      user_id, module_id, can_view, can_manage, source,
      inherited_from_position_id
    )
    select new.id, module_id, can_view, can_manage, 'position', new.position_id
    from public.position_module_permissions
    where position_id = new.position_id
    on conflict do nothing;

    insert into public.user_module_action_permissions (
      user_id, module_id, action, source, inherited_from_position_id
    )
    select new.id, module_id, action, 'position', new.position_id
    from public.position_module_action_permissions
    where position_id = new.position_id
    on conflict do nothing;
  elsif new.status = 'active' and new.user_type = 'customer' then
    insert into public.user_module_permissions (user_id, module_id, source)
    values (new.id, 'customer-portal', 'system')
    on conflict do nothing;
  elsif new.status = 'active' and new.user_type = 'supplier' then
    insert into public.user_module_permissions (user_id, module_id, source)
    values (new.id, 'supplier-portal', 'system')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

alter table public.position_module_action_permissions enable row level security;
alter table public.user_module_action_permissions enable row level security;
alter table public.file_objects enable row level security;

create policy position_module_actions_internal_select
on public.position_module_action_permissions
for select to authenticated using (public.is_internal_user());
create policy position_module_actions_admin_write
on public.position_module_action_permissions
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy user_module_actions_select_scope
on public.user_module_action_permissions
for select to authenticated
using (user_id = auth.uid() or public.is_administrator());
create policy user_module_actions_admin_write
on public.user_module_action_permissions
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy profiles_internal_directory_select on public.profiles
for select to authenticated
using (
  public.is_internal_user()
  and user_type in ('administrator', 'internal')
);

create policy file_objects_select_scope on public.file_objects
for select to authenticated
using (
  public.is_administrator()
  or uploaded_by = auth.uid()
  or (
    public.is_internal_user()
    and (
      (process_id is not null and public.has_process_access(process_id))
      or (module_id is not null and public.has_module_permission(module_id, 'view'))
    )
  )
  or (
    external_organization_id in (select public.current_organization_ids())
    and (
      audience = 'shared'
      or (audience = 'customer' and public.current_user_type() = 'customer')
      or (audience = 'supplier' and public.current_user_type() = 'supplier')
    )
  )
);

create policy file_objects_insert_scope on public.file_objects
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and (
    public.is_administrator()
    or (
      public.is_internal_user()
      and (
        (process_id is not null and public.has_process_access(process_id))
        or (module_id is not null and public.has_module_permission(module_id, 'create'))
      )
    )
    or external_organization_id in (select public.current_organization_ids())
  )
);

create policy file_objects_update_owner on public.file_objects
for update to authenticated
using (uploaded_by = auth.uid() or public.is_administrator())
with check (uploaded_by = auth.uid() or public.is_administrator());

create policy file_objects_delete_admin on public.file_objects
for delete to authenticated using (public.is_administrator());

insert into storage.buckets (id, name, public, file_size_limit)
values ('integraq-private', 'integraq-private', false, 52428800)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

create policy integraq_storage_insert_own_folder
on storage.objects for insert to authenticated
with check (
  bucket_id = 'integraq-private'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy integraq_storage_select_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'integraq-private'
  and (
    owner_id = auth.uid()::text
    or exists (
      select 1 from public.file_objects
      where bucket_id = storage.objects.bucket_id
        and object_path = storage.objects.name
    )
  )
);

create policy integraq_storage_update_owner
on storage.objects for update to authenticated
using (
  bucket_id = 'integraq-private'
  and (owner_id = auth.uid()::text or public.is_administrator())
)
with check (
  bucket_id = 'integraq-private'
  and (owner_id = auth.uid()::text or public.is_administrator())
);

create policy integraq_storage_delete_admin
on storage.objects for delete to authenticated
using (bucket_id = 'integraq-private' and public.is_administrator());

grant select, insert, update, delete
  on public.position_module_action_permissions to authenticated;
grant select, insert, update, delete
  on public.user_module_action_permissions to authenticated;
grant select, insert, update, delete on public.file_objects to authenticated;

insert into public.position_module_action_permissions (position_id, module_id, action)
select position_id, module_id, 'view'::public.module_permission_action
from public.position_module_permissions
where can_view
on conflict do nothing;

insert into public.position_module_action_permissions (position_id, module_id, action)
select position_id, module_id, allowed_action.action
from public.position_module_permissions
cross join unnest(enum_range(null::public.module_permission_action))
  as allowed_action(action)
where can_manage
on conflict do nothing;

-- Recalcula los permisos heredados de las cuentas que ya existían.
update public.profiles set status = status;

-- Actualiza la cuenta del administrador creada antes de ejecutar las migraciones.
update public.profiles
set user_type = 'administrator', status = 'active',
    continuous_improvement_role = 'manager'
where id in (
  select id from auth.users
  where lower(email) = 'f.hernandez@towell.com.mx'
);

comment on table public.file_objects is
  'Metadatos de archivos privados; el binario se conserva en Storage.';
comment on function public.has_external_organization_scope is
  'Aislamiento obligatorio para clientes y proveedores por organization_id.';
