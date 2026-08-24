-- IntegraQ: permisos editables por proceso y participación estricta por registro.
-- Requiere las migraciones 001 a 005.

create type public.corrective_action_participant_role as enum (
  'owner',
  'analysis',
  'action',
  'effectiveness',
  'viewer'
);

create table public.corrective_action_participants (
  corrective_action_id uuid not null
    references public.corrective_actions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  participant_role public.corrective_action_participant_role not null,
  assigned_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  assigned_at timestamptz not null default now(),
  primary key (corrective_action_id, profile_id, participant_role)
);

create index corrective_action_participants_profile_idx
  on public.corrective_action_participants(profile_id, corrective_action_id);

create or replace function public.sync_corrective_action_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'corrective_actions' then
    if tg_op = 'UPDATE' and old.owner_id is distinct from new.owner_id
      and old.owner_id is not null then
      delete from public.corrective_action_participants
      where corrective_action_id = new.id
        and profile_id = old.owner_id
        and participant_role = 'owner';
    end if;
    if new.owner_id is not null then
      insert into public.corrective_action_participants (
        corrective_action_id, profile_id, participant_role, assigned_by
      ) values (
        new.id, new.owner_id, 'owner', coalesce(auth.uid(), new.created_by)
      ) on conflict do nothing;
    end if;
  elsif new.owner_id is not null then
    insert into public.corrective_action_participants (
      corrective_action_id, profile_id, participant_role, assigned_by
    ) values (
      new.corrective_action_id,
      new.owner_id,
      'action',
      coalesce(auth.uid(), new.owner_id)
    ) on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger corrective_action_owner_participant
after insert or update of owner_id on public.corrective_actions
for each row execute function public.sync_corrective_action_participant();

create trigger corrective_plan_owner_participant
after insert or update of owner_id on public.corrective_action_plans
for each row execute function public.sync_corrective_action_participant();

insert into public.corrective_action_participants (
  corrective_action_id, profile_id, participant_role, assigned_by
)
select id, owner_id, 'owner', coalesce(created_by, owner_id)
from public.corrective_actions
where owner_id is not null
on conflict do nothing;

insert into public.corrective_action_participants (
  corrective_action_id, profile_id, participant_role, assigned_by
)
select corrective_action_id, owner_id, 'action', owner_id
from public.corrective_action_plans
where owner_id is not null
on conflict do nothing;

alter table public.corrective_action_participants enable row level security;

create or replace function public.can_access_corrective_action(
  requested_action_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.corrective_actions c
    where c.id = requested_action_id
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('corrective-actions', 'view')
          and (
            c.owner_id = auth.uid()
            or c.created_by = auth.uid()
            or exists (
              select 1
              from public.corrective_action_participants participant
              where participant.corrective_action_id = c.id
                and participant.profile_id = auth.uid()
            )
          )
        )
        or (
          c.source = 'customer'
          and c.portal_visible
          and public.has_external_organization_scope(
            'customer', c.external_organization_id
          )
        )
      )
  );
$$;

create policy corrective_participants_select_scope
on public.corrective_action_participants
for select to authenticated
using (public.can_access_corrective_action(corrective_action_id));

create policy corrective_participants_manage_scope
on public.corrective_action_participants
for all to authenticated
using (
  public.is_administrator()
  or (
    public.has_module_permission('corrective-actions', 'update')
    and public.can_access_corrective_action(corrective_action_id)
  )
)
with check (
  public.is_administrator()
  or (
    assigned_by = auth.uid()
    and public.has_module_permission('corrective-actions', 'update')
    and public.can_access_corrective_action(corrective_action_id)
  )
);

drop policy if exists corrective_actions_internal_write
  on public.corrective_actions;
create policy corrective_actions_internal_insert
on public.corrective_actions
for insert to authenticated
with check (
  public.is_internal_user()
  and public.has_module_permission('corrective-actions', 'create')
  and created_by = auth.uid()
  and (owner_id is null or owner_id = auth.uid() or public.is_administrator())
);
create policy corrective_actions_internal_update
on public.corrective_actions
for update to authenticated
using (
  public.is_administrator()
  or (
    public.has_module_permission('corrective-actions', 'update')
    and public.can_access_corrective_action(id)
  )
)
with check (
  public.is_administrator()
  or (
    public.has_module_permission('corrective-actions', 'update')
    and public.can_access_corrective_action(id)
  )
);
create policy corrective_actions_admin_delete
on public.corrective_actions
for delete to authenticated
using (public.is_administrator());

drop policy if exists corrective_a3_internal_write
  on public.corrective_action_a3;
create policy corrective_a3_internal_write
on public.corrective_action_a3
for all to authenticated
using (
  public.is_administrator()
  or (
    public.has_module_permission('corrective-actions', 'update')
    and public.can_access_corrective_action(corrective_action_id)
  )
)
with check (
  public.is_administrator()
  or (
    public.has_module_permission('corrective-actions', 'update')
    and public.can_access_corrective_action(corrective_action_id)
  )
);

drop policy if exists corrective_plans_internal_write
  on public.corrective_action_plans;
create policy corrective_plans_internal_write
on public.corrective_action_plans
for all to authenticated
using (
  public.is_administrator()
  or (
    public.has_module_permission('corrective-actions', 'update')
    and public.can_access_corrective_action(corrective_action_id)
  )
)
with check (
  public.is_administrator()
  or (
    public.has_module_permission('corrective-actions', 'update')
    and public.can_access_corrective_action(corrective_action_id)
  )
);

drop policy if exists effectiveness_internal_write
  on public.corrective_action_effectiveness_reviews;
create policy effectiveness_internal_write
on public.corrective_action_effectiveness_reviews
for all to authenticated
using (
  public.is_administrator()
  or (
    public.has_module_permission('corrective-actions', 'update')
    and public.can_access_corrective_action(corrective_action_id)
  )
)
with check (
  public.is_administrator()
  or (
    public.has_module_permission('corrective-actions', 'update')
    and public.can_access_corrective_action(corrective_action_id)
  )
);

create or replace function public.guard_indicator_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_indicator_id uuid;
  selected_process_id text;
  selected_opens_at timestamptz;
  selected_closes_at timestamptz;
begin
  select p.indicator_id, d.process_id, p.opens_at, p.closes_at
  into selected_indicator_id, selected_process_id,
    selected_opens_at, selected_closes_at
  from public.indicator_periods p
  join public.indicator_definitions d on d.id = p.indicator_id
  where p.id = new.period_id;

  if selected_indicator_id is null then
    raise exception 'Periodo de indicador inválido.';
  end if;
  if auth.uid() is not null and not public.is_administrator() then
    if not public.has_process_document_role(
      selected_process_id, 'modifier'
    ) then
      raise exception 'Se requiere acceso modificador para capturar el indicador.';
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

drop policy if exists indicator_results_insert_window
  on public.indicator_results;
create policy indicator_results_insert_window
on public.indicator_results
for insert to authenticated
with check (
  submitted_by = auth.uid()
  and exists (
    select 1
    from public.indicator_periods p
    join public.indicator_definitions i on i.id = p.indicator_id
    where p.id = period_id
      and public.has_process_document_role(i.process_id, 'modifier')
      and public.has_module_permission('indicators', 'update')
      and (public.is_administrator() or now() between p.opens_at and p.closes_at)
  )
);

drop policy if exists indicator_results_update_window
  on public.indicator_results;
create policy indicator_results_update_window
on public.indicator_results
for update to authenticated
using (
  exists (
    select 1
    from public.indicator_periods p
    join public.indicator_definitions i on i.id = p.indicator_id
    where p.id = period_id
      and public.has_process_document_role(i.process_id, 'modifier')
      and public.has_module_permission('indicators', 'update')
      and (public.is_administrator() or now() between p.opens_at and p.closes_at)
  )
)
with check (submitted_by = auth.uid() or public.is_administrator());

drop policy if exists improvement_projects_create
  on public.improvement_projects;
create policy improvement_projects_create
on public.improvement_projects
for insert to authenticated
with check (
  submitted_by = auth.uid()
  and public.is_internal_user()
  and public.has_process_access(process_id)
  and public.has_module_permission('continuous-improvement', 'create')
);

drop policy if exists improvement_projects_manage
  on public.improvement_projects;
create policy improvement_projects_manage
on public.improvement_projects
for update to authenticated
using (
  public.is_administrator()
  or public.has_module_permission('continuous-improvement', 'manage')
  or (
    public.has_module_permission('continuous-improvement', 'update')
    and public.can_access_improvement_project(id)
  )
)
with check (public.can_access_improvement_project(id));

drop policy if exists improvement_tools_write_scope
  on public.improvement_tools;
create policy improvement_tools_write_scope
on public.improvement_tools
for all to authenticated
using (
  public.has_module_permission('continuous-improvement', 'update')
  and exists (
    select 1 from public.improvement_phases p
    where p.id = phase_id
      and public.can_access_improvement_project(p.project_id)
  )
)
with check (
  public.has_module_permission('continuous-improvement', 'update')
  and exists (
    select 1 from public.improvement_phases p
    where p.id = phase_id
      and public.can_access_improvement_project(p.project_id)
  )
);

drop policy if exists improvement_actions_write_scope
  on public.improvement_actions;
create policy improvement_actions_write_scope
on public.improvement_actions
for all to authenticated
using (
  public.has_module_permission('continuous-improvement', 'update')
  and public.can_access_improvement_project(project_id)
)
with check (
  public.has_module_permission('continuous-improvement', 'update')
  and public.can_access_improvement_project(project_id)
);

drop policy if exists kaizen_reports_write_scope
  on public.kaizen_reports;
create policy kaizen_reports_write_scope
on public.kaizen_reports
for all to authenticated
using (
  public.has_module_permission('continuous-improvement', 'update')
  and public.can_access_improvement_project(project_id)
)
with check (
  public.has_module_permission('continuous-improvement', 'update')
  and public.can_access_improvement_project(project_id)
);

-- Las relaciones del organigrama siguen siendo la propuesta inicial.
insert into public.position_module_action_permissions (
  position_id, module_id, action
)
select distinct permission.position_id, permission.module_id, selected.action
from public.position_module_permissions permission
cross join lateral (
  values ('view'::public.module_permission_action)
) as selected(action)
where permission.can_view
on conflict do nothing;

insert into public.position_module_action_permissions (
  position_id, module_id, action
)
select distinct process_permission.position_id, selected.module_id,
  selected.action
from public.position_process_permissions process_permission
cross join lateral (
  values
    ('documents', 'update'::public.module_permission_action),
    ('indicators', 'update'::public.module_permission_action),
    ('risks', 'update'::public.module_permission_action),
    ('forms', 'create'::public.module_permission_action),
    ('forms', 'update'::public.module_permission_action),
    ('corrective-actions', 'update'::public.module_permission_action)
) as selected(module_id, action)
where process_permission.document_role in ('modifier', 'authorizer')
  and exists (
    select 1 from public.position_module_permissions module_permission
    where module_permission.position_id = process_permission.position_id
      and module_permission.module_id = selected.module_id
  )
on conflict do nothing;

insert into public.position_module_action_permissions (
  position_id, module_id, action
)
select distinct process_permission.position_id, 'continuous-improvement',
  'create'::public.module_permission_action
from public.position_process_permissions process_permission
where exists (
  select 1 from public.position_module_permissions module_permission
  where module_permission.position_id = process_permission.position_id
    and module_permission.module_id = 'continuous-improvement'
)
on conflict do nothing;

insert into public.position_module_action_permissions (
  position_id, module_id, action
)
select distinct process_permission.position_id, 'documents',
  'approve'::public.module_permission_action
from public.position_process_permissions process_permission
where process_permission.document_role = 'authorizer'
  and exists (
    select 1 from public.position_module_permissions module_permission
    where module_permission.position_id = process_permission.position_id
      and module_permission.module_id = 'documents'
  )
on conflict do nothing;

update public.profiles set status = status
where user_type = 'internal' and status = 'active';

grant select, insert, update, delete
  on public.corrective_action_participants to authenticated;

comment on table public.corrective_action_participants is
  'Limita Root2Cause a responsables y participantes explícitos de cada acción.';
comment on function public.can_access_corrective_action(uuid) is
  'Administrador ve todo; internos sólo acciones propias o asignadas; clientes sólo su empresa.';
