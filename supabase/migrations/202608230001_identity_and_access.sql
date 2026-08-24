create extension if not exists pgcrypto;

create type public.app_user_type as enum (
  'administrator',
  'internal',
  'customer',
  'supplier'
);
create type public.account_status as enum ('active', 'inactive');
create type public.organization_kind as enum ('internal', 'customer', 'supplier');
create type public.document_access_role as enum ('viewer', 'modifier', 'authorizer');
create type public.process_relationship as enum ('owner', 'approver', 'participant', 'support');
create type public.permission_source as enum ('position', 'direct', 'system');
create type public.improvement_role as enum ('submitter', 'manager');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind public.organization_kind not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.processes (
  id text primary key,
  name text not null,
  level text not null check (level in ('process', 'subprocess')),
  parent_id text references public.processes(id) on update cascade on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.positions (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  level smallint not null check (level between 1 and 4),
  parent_id text references public.positions(id) on update cascade on delete restrict,
  branch text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_modules (
  id text primary key,
  label text not null,
  category text not null,
  active boolean not null default true
);

create table public.position_process_permissions (
  position_id text not null references public.positions(id) on delete cascade,
  process_id text not null references public.processes(id) on delete cascade,
  relationship public.process_relationship not null,
  document_role public.document_access_role not null,
  primary key (position_id, process_id)
);

create table public.position_module_permissions (
  position_id text not null references public.positions(id) on delete cascade,
  module_id text not null references public.workspace_modules(id) on delete cascade,
  can_view boolean not null default true,
  can_manage boolean not null default false,
  primary key (position_id, module_id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  external_id text not null unique,
  full_name text not null,
  short_name text,
  initials text,
  organization_id uuid references public.organizations(id) on delete restrict,
  position_id text references public.positions(id) on delete restrict,
  position_name text,
  department text,
  company text,
  site text,
  user_type public.app_user_type not null default 'internal',
  status public.account_status not null default 'active',
  continuous_improvement_role public.improvement_role,
  external_party_kind public.organization_kind,
  external_party_id uuid references public.organizations(id) on delete restrict,
  external_party_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_scope_kind check (
    external_party_kind is null or external_party_kind in ('customer', 'supplier')
  ),
  constraint external_scope_required check (
    (
      user_type in ('administrator', 'internal')
      and external_party_kind is null
      and external_party_id is null
      and external_party_name is null
    )
    or
    (
      user_type = 'customer'
      and ((status = 'inactive' and external_party_id is null) or
        (external_party_kind = 'customer' and external_party_id is not null and external_party_name is not null))
    )
    or
    (
      user_type = 'supplier'
      and ((status = 'inactive' and external_party_id is null) or
        (external_party_kind = 'supplier' and external_party_id is not null and external_party_name is not null))
    )
  )
);

create table public.user_process_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  process_id text not null references public.processes(id) on delete cascade,
  document_role public.document_access_role not null,
  source public.permission_source not null default 'direct',
  inherited_from_position_id text references public.positions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, process_id)
);

create table public.user_module_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_id text not null references public.workspace_modules(id) on delete cascade,
  can_view boolean not null default true,
  can_manage boolean not null default false,
  source public.permission_source not null default 'direct',
  inherited_from_position_id text references public.positions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index profiles_position_idx on public.profiles(position_id);
create index profiles_external_party_idx on public.profiles(external_party_id);
create index audit_log_actor_created_idx on public.audit_log(actor_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();
create trigger processes_set_updated_at
before update on public.processes
for each row execute function public.set_updated_at();
create trigger positions_set_updated_at
before update on public.positions
for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
create trigger user_process_permissions_set_updated_at
before update on public.user_process_permissions
for each row execute function public.set_updated_at();
create trigger user_module_permissions_set_updated_at
before update on public.user_module_permissions
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_user_type public.app_user_type;
  resolved_name text;
begin
  resolved_user_type := case new.raw_app_meta_data ->> 'user_type'
    when 'administrator' then 'administrator'::public.app_user_type
    when 'customer' then 'customer'::public.app_user_type
    when 'supplier' then 'supplier'::public.app_user_type
    else 'internal'::public.app_user_type
  end;
  resolved_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.email, ''),
    'Usuario IntegraQ'
  );

  insert into public.profiles (
    id,
    external_id,
    full_name,
    user_type,
    status,
    continuous_improvement_role
  ) values (
    new.id,
    'USR-' || upper(substr(replace(new.id::text, '-', ''), 1, 12)),
    resolved_name,
    resolved_user_type,
    case when resolved_user_type in ('customer', 'supplier') then 'inactive'::public.account_status else 'active'::public.account_status end,
    case when resolved_user_type = 'administrator' then 'manager'::public.improvement_role else 'submitter'::public.improvement_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.sync_user_access_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_process_permissions where user_id = new.id;
  delete from public.user_module_permissions where user_id = new.id;

  if new.status = 'active' and new.user_type = 'internal' and new.position_id is not null then
    insert into public.user_process_permissions (
      user_id,
      process_id,
      document_role,
      source,
      inherited_from_position_id
    )
    select new.id, process_id, document_role, 'position', new.position_id
    from public.position_process_permissions
    where position_id = new.position_id;

    insert into public.user_module_permissions (
      user_id,
      module_id,
      can_view,
      can_manage,
      source,
      inherited_from_position_id
    )
    select new.id, module_id, can_view, can_manage, 'position', new.position_id
    from public.position_module_permissions
    where position_id = new.position_id;
  elsif new.status = 'active' and new.user_type = 'customer' then
    insert into public.user_module_permissions (user_id, module_id, source)
    values (new.id, 'customer-portal', 'system');
  elsif new.status = 'active' and new.user_type = 'supplier' then
    insert into public.user_module_permissions (user_id, module_id, source)
    values (new.id, 'supplier-portal', 'system');
  end if;

  return new;
end;
$$;

create trigger profiles_sync_access
after insert or update of position_id, user_type, status on public.profiles
for each row execute function public.sync_user_access_from_profile();

create or replace function public.is_administrator()
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
      and user_type = 'administrator'
      and status = 'active'
  );
$$;

create or replace function public.is_internal_user()
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
      and user_type in ('administrator', 'internal')
      and status = 'active'
  );
$$;

create or replace function public.current_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.profiles where id = auth.uid() and organization_id is not null
  union
  select external_party_id from public.profiles where id = auth.uid() and external_party_id is not null;
$$;

alter table public.organizations enable row level security;
alter table public.processes enable row level security;
alter table public.positions enable row level security;
alter table public.workspace_modules enable row level security;
alter table public.position_process_permissions enable row level security;
alter table public.position_module_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.user_process_permissions enable row level security;
alter table public.user_module_permissions enable row level security;
alter table public.audit_log enable row level security;

create policy organizations_select_scope on public.organizations
for select to authenticated
using (public.is_administrator() or id in (select public.current_organization_ids()));
create policy organizations_admin_write on public.organizations
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy processes_internal_select on public.processes
for select to authenticated using (public.is_internal_user());
create policy processes_admin_write on public.processes
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy positions_internal_select on public.positions
for select to authenticated using (public.is_internal_user());
create policy positions_admin_write on public.positions
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy modules_internal_select on public.workspace_modules
for select to authenticated using (public.is_internal_user());
create policy modules_admin_write on public.workspace_modules
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy position_process_internal_select on public.position_process_permissions
for select to authenticated using (public.is_internal_user());
create policy position_process_admin_write on public.position_process_permissions
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy position_module_internal_select on public.position_module_permissions
for select to authenticated using (public.is_internal_user());
create policy position_module_admin_write on public.position_module_permissions
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy profiles_select_own_or_admin on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_administrator());
create policy profiles_admin_write on public.profiles
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy user_process_select_own_or_admin on public.user_process_permissions
for select to authenticated
using (user_id = auth.uid() or public.is_administrator());
create policy user_process_admin_write on public.user_process_permissions
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy user_module_select_own_or_admin on public.user_module_permissions
for select to authenticated
using (user_id = auth.uid() or public.is_administrator());
create policy user_module_admin_write on public.user_module_permissions
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy audit_log_select_own_or_admin on public.audit_log
for select to authenticated
using (actor_id = auth.uid() or public.is_administrator());
create policy audit_log_insert_own on public.audit_log
for insert to authenticated
with check (actor_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.processes to authenticated;
grant select, insert, update, delete on public.positions to authenticated;
grant select, insert, update, delete on public.workspace_modules to authenticated;
grant select, insert, update, delete on public.position_process_permissions to authenticated;
grant select, insert, update, delete on public.position_module_permissions to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.user_process_permissions to authenticated;
grant select, insert, update, delete on public.user_module_permissions to authenticated;
grant select, insert on public.audit_log to authenticated;

insert into public.organizations (id, code, name, kind)
values ('00000000-0000-0000-0000-000000000001', 'TOWELL', 'Towell', 'internal');

insert into public.processes (id, name, level, parent_id) values
  ('P-01', 'Ventas', 'process', null),
  ('P-33', 'Satisfacción al cliente', 'subprocess', 'P-01'),
  ('P-02', 'Diseño', 'process', null),
  ('P-03', 'Dirección', 'process', null),
  ('P-04', 'Planeación', 'process', null),
  ('P-05', 'SMA', 'process', null),
  ('P-06', 'Contabilidad', 'process', null),
  ('P-07', 'Tecnologías de Información', 'process', null),
  ('P-08', 'Calidad', 'process', null),
  ('P-09', 'Almacén', 'process', null),
  ('P-10', 'Compras', 'process', null),
  ('P-11', 'Patrimonial', 'process', null),
  ('P-12', 'Mantenimiento', 'process', null),
  ('P-13', 'Tejido', 'process', null),
  ('P-14', 'Manufactura Urdido', 'subprocess', 'P-13'),
  ('P-15', 'Manufactura Engomado', 'subprocess', 'P-13'),
  ('P-16', 'Manufactura de Tejido', 'subprocess', 'P-13'),
  ('P-19', 'Manufactura de rollo rasurado', 'subprocess', 'P-13'),
  ('P-17', 'Tintorería', 'process', null),
  ('P-20', 'Manufactura de Toalla teñida', 'subprocess', 'P-17'),
  ('P-21', 'Manufactura de Toalla seca', 'subprocess', 'P-17'),
  ('P-18', 'Laboratorio', 'process', null),
  ('P-22', 'Costura', 'process', null),
  ('P-25', 'Manufactura de Confección de la toalla', 'subprocess', 'P-22'),
  ('P-26', 'Manufactura de Toalla estampada', 'subprocess', 'P-22'),
  ('P-27', 'Manufactura de Confección de Toalla', 'subprocess', 'P-22'),
  ('P-29', 'Manufactura de Empaque final', 'subprocess', 'P-22'),
  ('P-23', 'Corte de Bata', 'process', null),
  ('P-24', 'Confección de Bata', 'process', null),
  ('P-31', 'Mesa de Control', 'process', null),
  ('P-34', 'PT', 'process', null),
  ('P-28', 'PT Cubo', 'subprocess', 'P-34'),
  ('P-30', 'PT Preparación', 'subprocess', 'P-34'),
  ('P-32', 'PT Embarques', 'subprocess', 'P-34');

insert into public.positions (id, organization_id, name, level, parent_id, branch) values
  ('PU-01', '00000000-0000-0000-0000-000000000001', 'Dirección General', 1, null, 'Dirección'),
  ('PU-02', '00000000-0000-0000-0000-000000000001', 'Dirección de Operaciones', 2, 'PU-01', 'Operaciones'),
  ('PU-03', '00000000-0000-0000-0000-000000000001', 'Dirección Administrativa', 2, 'PU-01', 'Administración'),
  ('PU-04', '00000000-0000-0000-0000-000000000001', 'Dirección de Finanzas', 2, 'PU-01', 'Finanzas'),
  ('PU-05', '00000000-0000-0000-0000-000000000001', 'Dirección de Ventas', 2, 'PU-01', 'Ventas'),
  ('PU-06', '00000000-0000-0000-0000-000000000001', 'Gerencia de Costura', 3, 'PU-02', 'Operaciones'),
  ('PU-07', '00000000-0000-0000-0000-000000000001', 'Gerente de Aseguramiento de Calidad', 3, 'PU-01', 'Calidad'),
  ('PU-08', '00000000-0000-0000-0000-000000000001', 'Gerencia de Logística y Distribución', 3, 'PU-01', 'Logística'),
  ('PU-09', '00000000-0000-0000-0000-000000000001', 'Gerencia de Tecnologías de Información', 3, 'PU-03', 'Administración'),
  ('PU-10', '00000000-0000-0000-0000-000000000001', 'Gerencia de Recursos Humanos', 3, 'PU-04', 'Finanzas'),
  ('PU-11', '00000000-0000-0000-0000-000000000001', 'Gerencia de Cuentas Clave', 3, 'PU-05', 'Ventas'),
  ('PU-12', '00000000-0000-0000-0000-000000000001', 'Jefe de Tejido', 4, 'PU-02', 'Operaciones'),
  ('PU-13', '00000000-0000-0000-0000-000000000001', 'Jefe de Diseño', 4, 'PU-02', 'Operaciones'),
  ('PU-14', '00000000-0000-0000-0000-000000000001', 'Jefe de Teñido', 4, 'PU-02', 'Operaciones'),
  ('PU-15', '00000000-0000-0000-0000-000000000001', 'Jefe de S.H. y M.A.', 4, 'PU-02', 'Operaciones'),
  ('PU-16', '00000000-0000-0000-0000-000000000001', 'Aseguramiento de Calidad', 4, 'PU-07', 'Calidad'),
  ('PU-17', '00000000-0000-0000-0000-000000000001', 'Logística y Distribución', 4, 'PU-08', 'Logística'),
  ('PU-18', '00000000-0000-0000-0000-000000000001', 'Jefe de Compras', 4, 'PU-03', 'Administración'),
  ('PU-19', '00000000-0000-0000-0000-000000000001', 'Jefe de Costos', 4, 'PU-03', 'Administración'),
  ('PU-20', '00000000-0000-0000-0000-000000000001', 'Jefe de Contabilidad', 4, 'PU-03', 'Administración'),
  ('PU-21', '00000000-0000-0000-0000-000000000001', 'Jefe de Facturación', 4, 'PU-03', 'Administración'),
  ('PU-22', '00000000-0000-0000-0000-000000000001', 'Coordinador de Tesorería', 4, 'PU-04', 'Finanzas'),
  ('PU-23', '00000000-0000-0000-0000-000000000001', 'Coordinador de Cobranza', 4, 'PU-04', 'Finanzas'),
  ('PU-24', '00000000-0000-0000-0000-000000000001', 'Ejecutivos de Ventas', 4, 'PU-11', 'Ventas'),
  ('PU-25', '00000000-0000-0000-0000-000000000001', 'Jefe de Mantenimiento', 4, 'PU-02', 'Operaciones'),
  ('PU-26', '00000000-0000-0000-0000-000000000001', 'Jefe de Planeación', 4, 'PU-02', 'Operaciones'),
  ('PU-27', '00000000-0000-0000-0000-000000000001', 'Jefe de Almacén MP/Refacc.', 4, 'PU-02', 'Operaciones'),
  ('PU-28', '00000000-0000-0000-0000-000000000001', 'Promotoría', 4, 'PU-24', 'Ventas');

insert into public.workspace_modules (id, label, category) values
  ('home', 'Inicio', 'General'),
  ('processes', 'Procesos', 'Configuración'),
  ('organization', 'Organización y puestos', 'Configuración'),
  ('access', 'Usuarios y acceso', 'Configuración'),
  ('documents', 'Información documentada', 'Operación'),
  ('risks', 'Riesgos y oportunidades', 'Operación'),
  ('indicators', 'Objetivos e indicadores', 'Operación'),
  ('audits', 'Auditorías', 'Operación'),
  ('audit-app', 'App de auditorías', 'Operación'),
  ('corrective-actions', 'Root2Cause, NC y CAPA', 'Operación'),
  ('customers', 'Gestión de calidad de clientes', 'Operación'),
  ('customer-portal', 'Portal del cliente', 'Portales'),
  ('suppliers', 'Gestión de calidad de proveedores', 'Operación'),
  ('supplier-portal', 'Portal de proveedores', 'Portales'),
  ('management-review', 'Revisión por la Dirección', 'Dirección'),
  ('continuous-improvement', 'Mejora continua', 'Operación'),
  ('forms', 'Formularios y dashboards', 'Configuración'),
  ('ai-assistant', 'IA asistente', 'Plataforma'),
  ('integrations', 'Notificaciones e integraciones', 'Plataforma'),
  ('data-traceability', 'Datos y trazabilidad', 'Plataforma'),
  ('calibrations', 'Calibración y verificación', 'Operación');

insert into public.position_process_permissions (position_id, process_id, relationship, document_role) values
  ('PU-01', 'P-03', 'owner', 'modifier'), ('PU-01', 'P-04', 'approver', 'authorizer'), ('PU-01', 'P-08', 'approver', 'authorizer'),
  ('PU-02', 'P-02', 'approver', 'authorizer'), ('PU-02', 'P-04', 'approver', 'authorizer'), ('PU-02', 'P-05', 'approver', 'authorizer'), ('PU-02', 'P-09', 'approver', 'authorizer'), ('PU-02', 'P-12', 'approver', 'authorizer'), ('PU-02', 'P-13', 'approver', 'authorizer'), ('PU-02', 'P-17', 'approver', 'authorizer'), ('PU-02', 'P-18', 'approver', 'authorizer'), ('PU-02', 'P-22', 'approver', 'authorizer'), ('PU-02', 'P-23', 'approver', 'authorizer'), ('PU-02', 'P-24', 'approver', 'authorizer'), ('PU-02', 'P-31', 'approver', 'authorizer'), ('PU-02', 'P-34', 'approver', 'authorizer'),
  ('PU-03', 'P-06', 'approver', 'authorizer'), ('PU-03', 'P-07', 'approver', 'authorizer'), ('PU-03', 'P-10', 'approver', 'authorizer'), ('PU-03', 'P-11', 'approver', 'authorizer'),
  ('PU-04', 'P-06', 'approver', 'authorizer'), ('PU-04', 'P-01', 'support', 'viewer'),
  ('PU-05', 'P-01', 'approver', 'authorizer'), ('PU-05', 'P-33', 'approver', 'authorizer'),
  ('PU-06', 'P-22', 'owner', 'modifier'), ('PU-06', 'P-23', 'owner', 'modifier'), ('PU-06', 'P-24', 'owner', 'modifier'), ('PU-06', 'P-25', 'owner', 'modifier'), ('PU-06', 'P-26', 'owner', 'modifier'), ('PU-06', 'P-27', 'owner', 'modifier'), ('PU-06', 'P-29', 'owner', 'modifier'),
  ('PU-07', 'P-08', 'owner', 'modifier'), ('PU-07', 'P-33', 'support', 'viewer'),
  ('PU-08', 'P-31', 'owner', 'modifier'), ('PU-08', 'P-34', 'owner', 'modifier'), ('PU-08', 'P-28', 'owner', 'modifier'), ('PU-08', 'P-30', 'owner', 'modifier'), ('PU-08', 'P-32', 'owner', 'modifier'), ('PU-08', 'P-09', 'support', 'viewer'),
  ('PU-09', 'P-07', 'owner', 'modifier'),
  ('PU-11', 'P-01', 'owner', 'modifier'), ('PU-11', 'P-33', 'owner', 'modifier'),
  ('PU-12', 'P-13', 'owner', 'modifier'), ('PU-12', 'P-14', 'owner', 'modifier'), ('PU-12', 'P-15', 'owner', 'modifier'), ('PU-12', 'P-16', 'owner', 'modifier'), ('PU-12', 'P-19', 'owner', 'modifier'),
  ('PU-13', 'P-02', 'owner', 'modifier'),
  ('PU-14', 'P-17', 'owner', 'modifier'), ('PU-14', 'P-20', 'owner', 'modifier'), ('PU-14', 'P-21', 'owner', 'modifier'),
  ('PU-15', 'P-05', 'owner', 'modifier'),
  ('PU-16', 'P-08', 'participant', 'viewer'), ('PU-16', 'P-13', 'support', 'viewer'), ('PU-16', 'P-17', 'support', 'viewer'), ('PU-16', 'P-22', 'support', 'viewer'), ('PU-16', 'P-33', 'support', 'viewer'),
  ('PU-17', 'P-31', 'participant', 'viewer'), ('PU-17', 'P-32', 'owner', 'modifier'), ('PU-17', 'P-34', 'participant', 'viewer'),
  ('PU-18', 'P-10', 'owner', 'modifier'),
  ('PU-19', 'P-06', 'participant', 'viewer'), ('PU-19', 'P-13', 'support', 'viewer'), ('PU-19', 'P-17', 'support', 'viewer'), ('PU-19', 'P-22', 'support', 'viewer'),
  ('PU-20', 'P-06', 'owner', 'modifier'),
  ('PU-21', 'P-06', 'participant', 'viewer'), ('PU-21', 'P-01', 'support', 'viewer'), ('PU-21', 'P-32', 'support', 'viewer'),
  ('PU-22', 'P-06', 'participant', 'viewer'),
  ('PU-23', 'P-06', 'participant', 'viewer'), ('PU-23', 'P-01', 'support', 'viewer'),
  ('PU-24', 'P-01', 'participant', 'viewer'), ('PU-24', 'P-33', 'participant', 'viewer'),
  ('PU-25', 'P-12', 'owner', 'modifier'),
  ('PU-26', 'P-04', 'owner', 'modifier'),
  ('PU-27', 'P-09', 'owner', 'modifier'), ('PU-27', 'P-10', 'participant', 'viewer'),
  ('PU-28', 'P-01', 'participant', 'viewer'), ('PU-28', 'P-33', 'participant', 'viewer');

insert into public.position_module_permissions (position_id, module_id)
select id, module_id
from public.positions
cross join (values ('home'), ('documents'), ('continuous-improvement')) as base(module_id);

insert into public.position_module_permissions (position_id, module_id)
select distinct position_id, 'indicators'
from public.position_process_permissions
on conflict do nothing;

insert into public.position_module_permissions (position_id, module_id)
select distinct position_id, module_id
from public.position_process_permissions
cross join (values ('risks'), ('corrective-actions'), ('forms')) as owner_modules(module_id)
where relationship = 'owner'
on conflict do nothing;

insert into public.position_module_permissions (position_id, module_id)
select distinct position_id, 'audits'
from public.position_process_permissions
where relationship = 'approver'
on conflict do nothing;

insert into public.position_module_permissions (position_id, module_id)
select id, module_id
from public.positions
cross join (values ('audits'), ('corrective-actions'), ('customers'), ('suppliers'), ('calibrations')) as quality_modules(module_id)
where branch = 'Calidad'
on conflict do nothing;

insert into public.position_module_permissions (position_id, module_id)
select id, 'management-review'
from public.positions
where id in ('PU-01', 'PU-02')
on conflict do nothing;

insert into public.profiles (
  id,
  external_id,
  full_name,
  user_type,
  status,
  continuous_improvement_role
)
select
  id,
  'USR-' || upper(substr(replace(id::text, '-', ''), 1, 12)),
  coalesce(nullif(raw_user_meta_data ->> 'full_name', ''), nullif(email, ''), 'Usuario IntegraQ'),
  case raw_app_meta_data ->> 'user_type'
    when 'administrator' then 'administrator'::public.app_user_type
    when 'customer' then 'customer'::public.app_user_type
    when 'supplier' then 'supplier'::public.app_user_type
    else 'internal'::public.app_user_type
  end,
  case when raw_app_meta_data ->> 'user_type' in ('customer', 'supplier') then 'inactive'::public.account_status else 'active'::public.account_status end,
  case when raw_app_meta_data ->> 'user_type' = 'administrator' then 'manager'::public.improvement_role else 'submitter'::public.improvement_role end
from auth.users
on conflict (id) do nothing;

comment on column public.profiles.external_party_id is
  'Scope obligatorio para clientes y proveedores. Las políticas de cada tabla externa deben comparar este ID con el registro consultado.';
comment on table public.audit_log is
  'Bitácora inmutable: no se conceden permisos UPDATE ni DELETE al rol authenticated.';
