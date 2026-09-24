-- IntegraQ: evidencias transversales, previews normalizados y permisos por usuario.
-- Extiende file_objects y el catálogo RBAC existente; no crea tablas attachments paralelas.

alter table public.file_objects
  add column if not exists resource_key text,
  add column if not exists version integer not null default 1,
  add column if not exists is_current boolean not null default true,
  add column if not exists replaces_file_id uuid references public.file_objects(id) on delete set null,
  add column if not exists preview_path text,
  add column if not exists preview_status text not null default 'pending',
  add column if not exists preview_generated_at timestamptz,
  add column if not exists preview_error text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

update public.file_objects
set resource_key = resource_id::text
where resource_key is null and resource_id is not null;

update public.file_objects
set resource_key = process_id
where resource_key is null
  and resource_type = 'process_organization_chart'
  and process_id is not null;

with ranked as (
  select id,
    row_number() over (
      partition by resource_type, coalesce(resource_key, resource_id::text), coalesce(category, '')
      order by created_at, id
    ) as calculated_version,
    row_number() over (
      partition by resource_type, coalesce(resource_key, resource_id::text), coalesce(category, '')
      order by created_at desc, id desc
    ) as current_rank
  from public.file_objects
)
update public.file_objects file
set version = ranked.calculated_version,
    is_current = ranked.current_rank = 1
from ranked
where ranked.id = file.id;

update public.file_objects
set preview_status = case
  when lower(coalesce(mime_type, '')) = 'application/pdf'
    or lower(coalesce(mime_type, '')) like 'image/%' then 'not_required'
  else 'pending'
end
where preview_status = 'pending';

do $$ begin
  alter table public.file_objects
    add constraint file_objects_version_positive check (version > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.file_objects
    add constraint file_objects_preview_status_check check (
      preview_status in ('pending', 'processing', 'ready', 'error', 'not_required')
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.file_objects
    add constraint file_objects_preview_ready_path_check check (
      preview_status <> 'ready' or preview_path is not null
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.file_objects
    add constraint file_objects_soft_delete_actor_check check (
      deleted_at is null or deleted_by is not null
    );
exception when duplicate_object then null; end $$;

create index if not exists file_objects_resource_key_idx
  on public.file_objects(resource_type, resource_key, created_at desc);
create index if not exists file_objects_preview_queue_idx
  on public.file_objects(created_at)
  where preview_status in ('pending', 'processing') and deleted_at is null;
create index if not exists file_objects_replaces_idx
  on public.file_objects(replaces_file_id);
create unique index if not exists file_objects_one_current_resource_uidx
  on public.file_objects(
    resource_type,
    coalesce(resource_key, resource_id::text),
    coalesce(category, '')
  )
  where is_current and deleted_at is null
    and coalesce(resource_key, resource_id::text) is not null;

comment on table public.file_objects is
  'Registro transversal de adjuntos privados, evidencias, versiones, soft delete y previews PDF.';
comment on column public.file_objects.resource_key is
  'Identificador estable para entidades cuyo ID no es UUID, por ejemplo indicador+año+trimestre.';
comment on column public.file_objects.preview_path is
  'Ruta privada del PDF normalizado; el archivo original permanece en object_path.';

-- El catálogo central ya existe. Se amplía con las familias solicitadas.
insert into public.permissions(code, module, action, description, risk_level) values
  ('usuarios.ver','usuarios','ver','Ver usuarios','HIGH'),
  ('usuarios.crear','usuarios','crear','Crear usuarios','CRITICAL'),
  ('usuarios.editar','usuarios','editar','Editar usuarios','CRITICAL'),
  ('usuarios.desactivar','usuarios','desactivar','Desactivar usuarios','CRITICAL'),
  ('usuarios.administrar_permisos','usuarios','administrar_permisos','Administrar roles y permisos','CRITICAL'),
  ('clientes.acceder','clientes','acceder','Acceder al módulo de clientes','LOW'),
  ('clientes.ver','clientes','ver','Ver clientes','LOW'),
  ('clientes.crear','clientes','crear','Crear clientes','MEDIUM'),
  ('clientes.editar','clientes','editar','Editar clientes','MEDIUM'),
  ('clientes.administrar','clientes','administrar','Administrar clientes','HIGH'),
  ('proveedores.acceder','proveedores','acceder','Acceder al módulo de proveedores','LOW'),
  ('proveedores.ver','proveedores','ver','Ver proveedores','LOW'),
  ('proveedores.crear','proveedores','crear','Crear proveedores','MEDIUM'),
  ('proveedores.editar','proveedores','editar','Editar proveedores','MEDIUM'),
  ('proveedores.administrar','proveedores','administrar','Administrar proveedores','HIGH'),
  ('portal_clientes.acceder','portal_clientes','acceder','Acceder al Portal de Clientes','LOW'),
  ('portal_proveedores.acceder','portal_proveedores','acceder','Acceder al Portal de Proveedores','LOW'),
  ('organigrama.ver','organigrama','ver','Ver organigramas','LOW'),
  ('organigrama.crear','organigrama','crear','Crear organigramas','MEDIUM'),
  ('organigrama.editar','organigrama','editar','Actualizar organigramas','MEDIUM'),
  ('organigrama.eliminar','organigrama','eliminar','Eliminar organigramas lógicamente','HIGH'),
  ('evidencias.ver','evidencias','ver','Ver y descargar evidencias','LOW'),
  ('evidencias.agregar','evidencias','agregar','Agregar evidencias','MEDIUM'),
  ('evidencias.reemplazar','evidencias','reemplazar','Reemplazar evidencias conservando histórico','HIGH'),
  ('evidencias.eliminar','evidencias','eliminar','Eliminar evidencias lógicamente','HIGH'),
  ('evidencias.historial','evidencias','historial','Ver histórico de evidencias','HIGH')
on conflict (code) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description,
  risk_level = excluded.risk_level,
  status = 'active';

insert into public.role_permissions(role_id, permission_id, allowed)
select role.id, permission.id, true
from public.roles role
cross join public.permissions permission
where role.code = 'ADMIN'
on conflict (role_id, permission_id) do update set allowed = true;

insert into public.role_permissions(role_id, permission_id, allowed)
select role.id, permission.id, true
from public.roles role
join public.permissions permission on permission.code in (
  'clientes.acceder','clientes.ver','clientes.crear','clientes.editar','clientes.administrar',
  'proveedores.acceder','proveedores.ver','proveedores.crear','proveedores.editar','proveedores.administrar',
  'organigrama.ver','organigrama.crear','organigrama.editar','organigrama.eliminar',
  'evidencias.ver','evidencias.agregar','evidencias.reemplazar','evidencias.eliminar','evidencias.historial'
)
where role.code = 'QUALITY_USER'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions(role_id, permission_id, allowed)
select role.id, permission.id, true
from public.roles role
join public.permissions permission on
  (role.code = 'EXTERNAL_CUSTOMER' and permission.code = 'portal_clientes.acceder')
  or (role.code = 'EXTERNAL_SUPPLIER' and permission.code = 'portal_proveedores.acceder')
on conflict (role_id, permission_id) do nothing;

-- Rol base + excepciones específicas por usuario. Esta pieza no tenía equivalente
-- en el RBAC actual: user_roles sólo asignaba permisos completos por rol.
create table if not exists public.user_permission_overrides (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  allowed boolean not null default true,
  granted_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, permission_id)
);

create index if not exists user_permission_overrides_permission_idx
  on public.user_permission_overrides(permission_id, user_id);

drop trigger if exists user_permission_overrides_set_updated_at on public.user_permission_overrides;
create trigger user_permission_overrides_set_updated_at
before update on public.user_permission_overrides
for each row execute function public.set_updated_at();

-- Compatibilidad: traduce el acceso granular ya configurado a las nuevas claves
-- sin retirar las asignaciones legacy que siguen usando las políticas existentes.
insert into public.user_permission_overrides(user_id, permission_id, allowed, granted_by)
select module_permission.user_id, permission.id, true, null
from public.user_module_permissions module_permission
join public.permissions permission on
  (module_permission.module_id = 'customers' and module_permission.can_view and permission.code in ('clientes.acceder','clientes.ver'))
  or (module_permission.module_id = 'customers' and module_permission.can_manage and permission.code in ('clientes.crear','clientes.editar','clientes.administrar'))
  or (module_permission.module_id = 'suppliers' and module_permission.can_view and permission.code in ('proveedores.acceder','proveedores.ver'))
  or (module_permission.module_id = 'suppliers' and module_permission.can_manage and permission.code in ('proveedores.crear','proveedores.editar','proveedores.administrar'))
  or (module_permission.module_id = 'documents' and module_permission.can_view and permission.code in ('organigrama.ver','evidencias.ver'))
  or (module_permission.module_id = 'documents' and module_permission.can_manage and permission.code in ('organigrama.crear','organigrama.editar','organigrama.eliminar','evidencias.agregar','evidencias.reemplazar','evidencias.eliminar','evidencias.historial'))
on conflict (user_id, permission_id) do nothing;

insert into public.user_permission_overrides(user_id, permission_id, allowed, granted_by)
select action_permission.user_id, permission.id, true, null
from public.user_module_action_permissions action_permission
join public.permissions permission on
  (action_permission.module_id = 'customers' and action_permission.action = 'view' and permission.code in ('clientes.acceder','clientes.ver'))
  or (action_permission.module_id = 'customers' and action_permission.action in ('create','update','manage') and permission.code in ('clientes.crear','clientes.editar','clientes.administrar'))
  or (action_permission.module_id = 'suppliers' and action_permission.action = 'view' and permission.code in ('proveedores.acceder','proveedores.ver'))
  or (action_permission.module_id = 'suppliers' and action_permission.action in ('create','update','manage') and permission.code in ('proveedores.crear','proveedores.editar','proveedores.administrar'))
  or (action_permission.module_id = 'documents' and action_permission.action = 'view' and permission.code in ('organigrama.ver','evidencias.ver'))
  or (action_permission.module_id = 'documents' and action_permission.action in ('create','update','manage') and permission.code in ('organigrama.crear','organigrama.editar','evidencias.agregar','evidencias.reemplazar'))
  or (action_permission.module_id = 'documents' and action_permission.action = 'manage' and permission.code in ('organigrama.eliminar','evidencias.eliminar','evidencias.historial'))
on conflict (user_id, permission_id) do nothing;

-- Un override explícito denegado prevalece sobre el rol. Un permiso explícito
-- permitido es global para ese usuario; el resto conserva el alcance del rol.
create or replace function public.has_permission(
  requested_permission text,
  requested_organization_id uuid default null,
  requested_area_id uuid default null,
  requested_process_id text default null,
  record_owner_id uuid default null,
  is_assigned boolean default false,
  requested_company_id uuid default null
) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_administrator() or (
    exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.status = 'active'
    )
    and not exists (
      select 1
      from public.user_permission_overrides override
      join public.permissions permission on permission.id = override.permission_id
      where override.user_id = auth.uid()
        and permission.code = requested_permission
        and permission.status = 'active'
        and not override.allowed
    )
    and (
      exists (
        select 1
        from public.user_permission_overrides override
        join public.permissions permission on permission.id = override.permission_id
        where override.user_id = auth.uid()
          and permission.code = requested_permission
          and permission.status = 'active'
          and override.allowed
      )
      or exists (
        select 1 from public.user_roles assignment
        join public.roles role on role.id = assignment.role_id and role.status = 'active'
        join public.role_permissions role_permission on role_permission.role_id = role.id and role_permission.allowed
        join public.permissions permission on permission.id = role_permission.permission_id and permission.status = 'active'
        join public.profiles profile on profile.id = assignment.user_id and profile.status = 'active'
        where assignment.user_id = auth.uid() and assignment.status = 'active'
          and assignment.starts_at <= now() and (assignment.ends_at is null or assignment.ends_at >= now())
          and permission.code = requested_permission
          and case role.scope_type
            when 'global' then true
            when 'organization' then assignment.organization_id = requested_organization_id
            when 'area' then assignment.area_id = requested_area_id
            when 'process' then assignment.process_id = requested_process_id
            when 'own_records' then record_owner_id = auth.uid()
            when 'assigned_records' then is_assigned
            when 'company' then profile.external_party_id = requested_company_id and assignment.organization_id = requested_company_id
            else false end
      )
    )
  );
$$;

alter table public.user_permission_overrides enable row level security;
drop policy if exists user_permission_overrides_read on public.user_permission_overrides;
create policy user_permission_overrides_read on public.user_permission_overrides
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_administrator()
  or public.has_permission('usuarios.administrar_permisos')
);
drop policy if exists user_permission_overrides_manage on public.user_permission_overrides;
create policy user_permission_overrides_manage on public.user_permission_overrides
for all to authenticated
using (
  public.is_administrator()
  or public.has_permission('usuarios.administrar_permisos')
)
with check (
  public.is_administrator()
  or public.has_permission('usuarios.administrar_permisos')
);

grant select, insert, update, delete on public.user_permission_overrides to authenticated;
grant execute on function public.has_permission(text, uuid, uuid, text, uuid, boolean, uuid) to authenticated;

-- La bitácora existente conserva cada diferencia permiso anterior -> permiso nuevo.
create or replace function public.audit_user_permission_override()
returns trigger language plpgsql security definer set search_path = '' as $$
declare selected_permission text;
declare selected_user uuid;
begin
  selected_user := coalesce(new.user_id, old.user_id);
  select code into selected_permission
  from public.permissions
  where id = coalesce(new.permission_id, old.permission_id);

  insert into public.audit_log(
    actor_id, action, resource_type, resource_id,
    previous_value, new_value, metadata, origin
  ) values (
    auth.uid(), 'user.permission_changed', 'profile', selected_user::text,
    case when tg_op = 'INSERT' then null else jsonb_build_object('permission', selected_permission, 'allowed', old.allowed) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object('permission', selected_permission, 'allowed', new.allowed) end,
    jsonb_build_object('permission', selected_permission, 'operation', tg_op),
    case when public.is_administrator() then 'admin_override'::public.activity_origin else 'human'::public.activity_origin end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists user_permission_overrides_audit on public.user_permission_overrides;
create trigger user_permission_overrides_audit
after insert or update or delete on public.user_permission_overrides
for each row execute function public.audit_user_permission_override();

-- Storage sigue privado. Se autoriza también el PDF preview asociado al registro visible.
drop policy if exists integraq_storage_select_authorized on storage.objects;
create policy integraq_storage_select_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'integraq-private'
  and (
    owner_id = auth.uid()::text
    or exists (
      select 1 from public.file_objects file
      where file.bucket_id = storage.objects.bucket_id
        and (file.object_path = storage.objects.name or file.preview_path = storage.objects.name)
        and (file.deleted_at is null or public.is_administrator())
    )
  )
);

drop policy if exists file_objects_select_scope on public.file_objects;
create policy file_objects_select_scope on public.file_objects
for select to authenticated
using (
  public.is_administrator()
  or (
    deleted_at is null
    and (
      uploaded_by = auth.uid()
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
    )
  )
);

-- Clientes y proveedores: acceso, lectura y administración coinciden en menú,
-- RLS y operaciones. Los IDs de módulos existentes se conservan.
drop policy if exists quality_cases_select_scope on public.quality_cases;
create policy quality_cases_select_scope on public.quality_cases
for select to authenticated
using (
  public.is_administrator()
  or (
    public.is_internal_user()
    and public.has_module_permission('customers', 'view')
    and public.has_permission('clientes.acceder')
    and public.has_permission('clientes.ver')
  )
  or (
    portal_visible
    and public.has_external_organization_scope('customer', external_organization_id)
    and public.has_permission('portal_clientes.acceder', null, null, null, null, false, external_organization_id)
  )
);

drop policy if exists supplier_profiles_select_scope on public.supplier_quality_profiles;
create policy supplier_profiles_select_scope on public.supplier_quality_profiles
for select to authenticated
using (
  public.is_administrator()
  or (
    public.is_internal_user()
    and public.has_module_permission('suppliers', 'view')
    and public.has_permission('proveedores.acceder')
    and public.has_permission('proveedores.ver')
  )
  or (
    public.has_external_organization_scope('supplier', organization_id)
    and public.has_permission('portal_proveedores.acceder', null, null, null, null, false, organization_id)
  )
);

create or replace function public.can_access_supplier_report(requested_report_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.supplier_rncp_reports report
    where report.id = requested_report_id
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('suppliers', 'view')
          and public.has_permission('proveedores.acceder')
          and public.has_permission('proveedores.ver')
        )
        or (
          report.portal_visible
          and public.has_external_organization_scope('supplier', report.supplier_id)
          and public.has_permission('portal_proveedores.acceder', null, null, null, null, false, report.supplier_id)
        )
      )
  );
$$;

create or replace function public.can_access_audit(requested_audit_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.audits audit
    where audit.id = requested_audit_id
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('audits', 'view')
          and (audit.process_id is null or public.has_process_access(audit.process_id))
        )
        or (
          public.current_user_type() = 'customer'
          and audit.portal_visible
          and audit.external_organization_id is not null
          and public.has_external_organization_scope('customer', audit.external_organization_id)
          and public.has_permission('portal_clientes.acceder', null, null, null, null, false, audit.external_organization_id)
        )
        or (
          public.current_user_type() = 'supplier'
          and audit.portal_visible
          and audit.audit_type = 'supplier'
          and public.has_external_organization_scope('supplier', audit.external_organization_id)
          and public.has_permission('portal_proveedores.acceder', null, null, null, null, false, audit.external_organization_id)
        )
      )
  );
$$;

create or replace function public.can_access_corrective_action(requested_action_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.corrective_actions action
    where action.id = requested_action_id
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('corrective-actions', 'view')
          and (
            action.owner_id = auth.uid()
            or action.created_by = auth.uid()
            or exists (
              select 1 from public.corrective_action_participants participant
              where participant.corrective_action_id = action.id
                and participant.profile_id = auth.uid()
            )
          )
        )
        or (
          action.source = 'customer'
          and action.portal_visible
          and public.has_external_organization_scope('customer', action.external_organization_id)
          and public.has_permission('portal_clientes.acceder', null, null, null, null, false, action.external_organization_id)
        )
      )
  );
$$;

drop policy if exists supplier_evaluations_select_scope on public.supplier_quality_evaluations;
create policy supplier_evaluations_select_scope on public.supplier_quality_evaluations
for select to authenticated
using (
  public.is_administrator()
  or (
    public.is_internal_user()
    and public.has_module_permission('suppliers', 'view')
    and public.has_permission('proveedores.acceder')
    and public.has_permission('proveedores.ver')
  )
  or (
    public.has_external_organization_scope('supplier', supplier_id)
    and public.has_permission('portal_proveedores.acceder', null, null, null, null, false, supplier_id)
  )
);

drop policy if exists quality_cases_internal_write on public.quality_cases;
create policy quality_cases_internal_insert on public.quality_cases
for insert to authenticated with check (
  public.is_internal_user()
  and public.has_module_permission('customers', 'create')
  and (public.has_permission('clientes.crear') or public.has_permission('clientes.administrar'))
);
create policy quality_cases_internal_update on public.quality_cases
for update to authenticated
using (
  public.is_internal_user()
  and public.has_module_permission('customers', 'update')
  and (public.has_permission('clientes.editar') or public.has_permission('clientes.administrar'))
)
with check (
  public.is_internal_user()
  and public.has_module_permission('customers', 'update')
  and (public.has_permission('clientes.editar') or public.has_permission('clientes.administrar'))
);
create policy quality_cases_internal_delete on public.quality_cases
for delete to authenticated using (
  public.is_internal_user()
  and public.has_module_permission('customers', 'manage')
  and public.has_permission('clientes.administrar')
);
