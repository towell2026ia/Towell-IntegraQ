-- IntegraQ: visibilidad y alcance del Inicio por proceso y usuario.
-- Reutiliza user_process_permissions como relación usuario-proceso existente.

insert into public.workspace_modules (id, label, category)
values ('home-settings', 'Configuración de Inicio', 'Configuración')
on conflict (id) do update set
  label = excluded.label,
  category = excluded.category;

create type public.home_section_scope as enum (
  'all_processes',
  'selected_processes',
  'specific_users'
);

create table public.home_sections (
  id text primary key,
  label text not null,
  description text not null default '',
  scope public.home_section_scope not null default 'all_processes',
  visible_to_administrators boolean not null default true,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.home_section_processes (
  home_section_id text not null
    references public.home_sections(id) on delete cascade,
  process_id text not null
    references public.processes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (home_section_id, process_id)
);

create table public.home_section_users (
  home_section_id text not null
    references public.home_sections(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (home_section_id, user_id)
);

create index home_section_processes_process_idx
  on public.home_section_processes(process_id, home_section_id);
create index home_section_users_user_idx
  on public.home_section_users(user_id, home_section_id);

create trigger home_sections_set_updated_at
before update on public.home_sections
for each row execute function public.set_updated_at();

create or replace function public.current_authorized_process_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select process.id
  from public.processes process
  where process.active and public.is_administrator()
  union
  select permission.process_id
  from public.user_process_permissions permission
  join public.profiles profile on profile.id = permission.user_id
  join public.processes process on process.id = permission.process_id
  where permission.user_id = auth.uid()
    and profile.status = 'active'
    and profile.user_type = 'internal'
    and process.active;
$$;

create or replace function public.can_view_home_section(
  requested_section_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.home_sections section
    where section.id = requested_section_id
      and section.active
      and (
        (public.is_administrator() and section.visible_to_administrators)
        or (
          public.is_internal_user()
          and not public.is_administrator()
          and (
            section.scope = 'all_processes'
            or (
              section.scope = 'selected_processes'
              and exists (
                select 1
                from public.home_section_processes section_process
                where section_process.home_section_id = section.id
                  and section_process.process_id in (
                    select public.current_authorized_process_ids()
                  )
              )
            )
            or (
              section.scope = 'specific_users'
              and exists (
                select 1
                from public.home_section_users section_user
                where section_user.home_section_id = section.id
                  and section_user.user_id = auth.uid()
              )
            )
          )
        )
      )
  );
$$;

alter table public.home_sections enable row level security;
alter table public.home_section_processes enable row level security;
alter table public.home_section_users enable row level security;

create policy home_sections_select_visible on public.home_sections
for select to authenticated
using (public.can_view_home_section(id));
create policy home_sections_admin_manage on public.home_sections
for all to authenticated
using (public.is_administrator())
with check (public.is_administrator());

create policy home_section_processes_select_visible
on public.home_section_processes
for select to authenticated
using (public.can_view_home_section(home_section_id));
create policy home_section_processes_admin_manage
on public.home_section_processes
for all to authenticated
using (public.is_administrator())
with check (public.is_administrator());

create policy home_section_users_select_own
on public.home_section_users
for select to authenticated
using (public.is_administrator() or user_id = auth.uid());
create policy home_section_users_admin_manage
on public.home_section_users
for all to authenticated
using (public.is_administrator())
with check (public.is_administrator());

grant select, insert, update, delete on public.home_sections to authenticated;
grant select, insert, update, delete on public.home_section_processes to authenticated;
grant select, insert, update, delete on public.home_section_users to authenticated;
grant execute on function public.current_authorized_process_ids() to authenticated;
grant execute on function public.can_view_home_section(text) to authenticated;

insert into public.home_sections (
  id, label, description, scope, display_order
) values
  ('quality-policy', 'Política de Calidad', 'Política general del Sistema de Gestión de Calidad.', 'all_processes', 10),
  ('quality-objectives', 'Objetivos de Calidad', 'Objetivos e indicadores vinculados con los procesos autorizados.', 'all_processes', 20),
  ('alerts', 'Alertas', 'Situaciones críticas o que requieren atención.', 'all_processes', 30),
  ('pending-tasks', 'Pendientes', 'Actividades bajo responsabilidad del usuario o de sus procesos.', 'all_processes', 40),
  ('document-status', 'Estado documental', 'Documentos revisados, en validación, vigentes y por corregir.', 'all_processes', 50),
  ('upcoming-events', 'Próximos eventos', 'Vencimientos, auditorías y compromisos programados.', 'all_processes', 60),
  ('performance', 'Indicadores clave', 'Resumen de desempeño calculado dentro del alcance autorizado.', 'all_processes', 70),
  ('module-status', 'Estado de módulos', 'Resumen operativo de los módulos conectados.', 'all_processes', 80),
  ('trends', 'Tendencias', 'Distribución de estados y evolución operativa.', 'all_processes', 90),
  ('recent-activity', 'Actividad reciente', 'Movimientos recientes de registros autorizados.', 'all_processes', 100),
  ('quick-actions', 'Acciones rápidas', 'Atajos disponibles de acuerdo con el rol del usuario.', 'all_processes', 110)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  display_order = excluded.display_order;

-- Un objetivo/indicador puede aplicar a uno o varios procesos.
create table public.indicator_definition_processes (
  indicator_id uuid not null
    references public.indicator_definitions(id) on delete cascade,
  process_id text not null references public.processes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (indicator_id, process_id)
);

create index indicator_definition_processes_process_idx
  on public.indicator_definition_processes(process_id, indicator_id);

insert into public.indicator_definition_processes (indicator_id, process_id)
select id, process_id from public.indicator_definitions
on conflict do nothing;

create or replace function public.can_access_indicator(
  requested_indicator_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_administrator() or exists (
    select 1
    from public.indicator_definition_processes relation
    where relation.indicator_id = requested_indicator_id
      and public.has_process_access(relation.process_id)
  );
$$;

create or replace function public.can_modify_indicator(
  requested_indicator_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_administrator() or exists (
    select 1
    from public.indicator_definition_processes relation
    where relation.indicator_id = requested_indicator_id
      and public.has_process_document_role(relation.process_id, 'modifier')
  );
$$;

alter table public.indicator_definition_processes enable row level security;
create policy indicator_definition_processes_select_scope
on public.indicator_definition_processes
for select to authenticated
using (public.can_access_indicator(indicator_id));
create policy indicator_definition_processes_admin_manage
on public.indicator_definition_processes
for all to authenticated
using (public.is_administrator())
with check (public.is_administrator());

drop policy if exists indicators_select_process on public.indicator_definitions;
create policy indicators_select_process on public.indicator_definitions
for select to authenticated
using (
  public.has_module_permission('indicators', 'view')
  and public.can_access_indicator(id)
);

drop policy if exists indicator_rules_select_process on public.indicator_evaluation_rules;
create policy indicator_rules_select_process on public.indicator_evaluation_rules
for select to authenticated
using (public.can_access_indicator(indicator_id));

drop policy if exists indicator_periods_select_process on public.indicator_periods;
create policy indicator_periods_select_process on public.indicator_periods
for select to authenticated
using (public.can_access_indicator(indicator_id));

drop policy if exists indicator_results_select_process on public.indicator_results;
create policy indicator_results_select_process on public.indicator_results
for select to authenticated
using (exists (
  select 1 from public.indicator_periods period
  where period.id = period_id
    and public.can_access_indicator(period.indicator_id)
));

drop policy if exists indicator_results_insert_window on public.indicator_results;
create policy indicator_results_insert_window on public.indicator_results
for insert to authenticated
with check (
  submitted_by = auth.uid()
  and exists (
    select 1 from public.indicator_periods period
    where period.id = period_id
      and public.can_modify_indicator(period.indicator_id)
      and public.has_module_permission('indicators', 'update')
      and (public.is_administrator() or now() between period.opens_at and period.closes_at)
  )
);

drop policy if exists indicator_results_update_window on public.indicator_results;
create policy indicator_results_update_window on public.indicator_results
for update to authenticated
using (exists (
  select 1 from public.indicator_periods period
  where period.id = period_id
    and public.can_modify_indicator(period.indicator_id)
    and public.has_module_permission('indicators', 'update')
    and (public.is_administrator() or now() between period.opens_at and period.closes_at)
))
with check (submitted_by = auth.uid() or public.is_administrator());

create or replace function public.guard_indicator_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_indicator_id uuid;
  selected_opens_at timestamptz;
  selected_closes_at timestamptz;
begin
  select period.indicator_id, period.opens_at, period.closes_at
  into selected_indicator_id, selected_opens_at, selected_closes_at
  from public.indicator_periods period
  where period.id = new.period_id;

  if selected_indicator_id is null then
    raise exception 'Periodo de indicador inválido.';
  end if;
  if auth.uid() is not null and not public.is_administrator() then
    if not public.can_modify_indicator(selected_indicator_id) then
      raise exception 'Se requiere acceso modificador a uno de los procesos del indicador.';
    end if;
    if not public.has_module_permission('indicators', 'update') then
      raise exception 'El usuario no tiene permiso para capturar indicadores.';
    end if;
    if now() < selected_opens_at or now() > selected_closes_at then
      raise exception 'La captura está fuera de la ventana programada.';
    end if;
  end if;

  new.evaluation_status := public.evaluate_indicator_value(
    selected_indicator_id, new.value
  );
  new.submitted_by := coalesce(auth.uid(), new.submitted_by);
  new.submitted_at := now();
  return new;
end;
$$;

grant select, insert, update, delete
on public.indicator_definition_processes to authenticated;
grant execute on function public.can_access_indicator(uuid) to authenticated;
grant execute on function public.can_modify_indicator(uuid) to authenticated;
