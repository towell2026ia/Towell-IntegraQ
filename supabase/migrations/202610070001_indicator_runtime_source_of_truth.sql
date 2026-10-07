-- IQ-PRD-IND-01: Supabase como fuente única de verdad para Indicadores.
-- No importa información local, no crea datos demo y no elimina resultados existentes.

begin;

alter table public.indicator_definitions
  add column if not exists workspace_mode text not null default 'production'
    check (workspace_mode in ('demo', 'production')),
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

update public.indicator_definitions definition
set organization_id = process.organization_id
from public.processes process
where definition.process_id = process.id
  and definition.organization_id is null;

alter table public.indicator_definitions
  drop constraint if exists indicator_definitions_code_key;

create unique index if not exists indicator_definitions_workspace_code_uidx
  on public.indicator_definitions(organization_id, workspace_mode, code);
create index if not exists indicator_definitions_runtime_scope_idx
  on public.indicator_definitions(organization_id, workspace_mode, active, process_id);

alter table public.indicator_periods
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists indicator_periods_set_updated_at on public.indicator_periods;
create trigger indicator_periods_set_updated_at
before update on public.indicator_periods
for each row execute function public.set_updated_at();

create index if not exists indicator_periods_indicator_year_idx
  on public.indicator_periods(indicator_id, year, quarter);
create index if not exists indicator_results_submitted_idx
  on public.indicator_results(submitted_at desc, submitted_by);

create or replace function public.save_indicator_runtime(
  requested_code text,
  requested_source_row integer,
  requested_process_id text,
  requested_process_ids text[],
  requested_area text,
  requested_direction_objective text,
  requested_direction_metric text,
  requested_quality_objective text,
  requested_name text,
  requested_leader_name text,
  requested_metric_label text,
  requested_description text,
  requested_rules jsonb,
  requested_periods jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_organization_id uuid;
  actor_workspace_mode text;
  saved_indicator_id uuid;
  normalized_process_ids text[];
  period jsonb;
begin
  select profile.organization_id, profile.workspace_mode
  into actor_organization_id, actor_workspace_mode
  from public.profiles profile
  where profile.id = actor_id
    and profile.status = 'active'
    and profile.user_type = 'administrator';

  if actor_organization_id is null then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  if length(trim(coalesce(requested_code, ''))) = 0
    or length(trim(coalesce(requested_name, ''))) = 0
    or length(trim(coalesce(requested_process_id, ''))) = 0 then
    raise exception using errcode = '22023', message = 'INVALID_INDICATOR';
  end if;

  normalized_process_ids := array(
    select distinct process_id
    from unnest(array_append(coalesce(requested_process_ids, '{}'::text[]), requested_process_id)) process_id
    where length(trim(process_id)) > 0
  );

  if exists (
    select 1
    from unnest(normalized_process_ids) requested(process_id)
    left join public.processes process on process.id = requested.process_id
    where process.id is null
      or process.organization_id is distinct from actor_organization_id
  ) then
    raise exception using errcode = '23514', message = 'INVALID_PROCESS_SCOPE';
  end if;

  select definition.id into saved_indicator_id
  from public.indicator_definitions definition
  where definition.organization_id = actor_organization_id
    and definition.workspace_mode = actor_workspace_mode
    and definition.code = trim(requested_code);

  if saved_indicator_id is null then
    insert into public.indicator_definitions (
      code, source_row, process_id, area, direction_objective, direction_metric,
      quality_objective, name, leader_name, owner_name_snapshot, metric_label,
      description, periodicity, active, organization_id, area_id, workspace_mode,
      created_by, updated_by
    )
    select
      trim(requested_code), requested_source_row, requested_process_id, trim(requested_area),
      nullif(trim(coalesce(requested_direction_objective, '')), ''),
      nullif(trim(coalesce(requested_direction_metric, '')), ''),
      nullif(trim(coalesce(requested_quality_objective, '')), ''), trim(requested_name),
      nullif(trim(coalesce(requested_leader_name, '')), ''),
      nullif(trim(coalesce(requested_leader_name, '')), ''), trim(requested_metric_label),
      nullif(trim(coalesce(requested_description, '')), ''), 'quarterly', true,
      actor_organization_id, process.area_id, actor_workspace_mode, actor_id, actor_id
    from public.processes process
    where process.id = requested_process_id
    returning id into saved_indicator_id;
  else
    update public.indicator_definitions definition
    set source_row = requested_source_row,
        process_id = requested_process_id,
        area = trim(requested_area),
        direction_objective = nullif(trim(coalesce(requested_direction_objective, '')), ''),
        direction_metric = nullif(trim(coalesce(requested_direction_metric, '')), ''),
        quality_objective = nullif(trim(coalesce(requested_quality_objective, '')), ''),
        name = trim(requested_name),
        leader_name = nullif(trim(coalesce(requested_leader_name, '')), ''),
        owner_name_snapshot = nullif(trim(coalesce(requested_leader_name, '')), ''),
        metric_label = trim(requested_metric_label),
        description = nullif(trim(coalesce(requested_description, '')), ''),
        area_id = process.area_id,
        active = true,
        updated_by = actor_id
    from public.processes process
    where definition.id = saved_indicator_id
      and process.id = requested_process_id;
  end if;

  insert into public.indicator_evaluation_rules (
    indicator_id, rule_type, target_min, target_max, target_value,
    marginal_tolerance_percent, unit, compliant_rule, marginal_rule,
    noncompliant_rule, updated_by
  ) values (
    saved_indicator_id,
    (requested_rules ->> 'ruleType')::public.indicator_rule_type,
    nullif(requested_rules ->> 'targetMin', '')::numeric,
    nullif(requested_rules ->> 'targetMax', '')::numeric,
    nullif(requested_rules ->> 'targetValue', '')::numeric,
    coalesce(nullif(requested_rules ->> 'marginalTolerancePercent', '')::numeric, 5),
    coalesce(nullif(requested_rules ->> 'unit', ''), 'value'),
    requested_rules ->> 'compliant',
    requested_rules ->> 'marginal',
    requested_rules ->> 'noncompliant',
    actor_id
  )
  on conflict (indicator_id) do update set
    rule_type = excluded.rule_type,
    target_min = excluded.target_min,
    target_max = excluded.target_max,
    target_value = excluded.target_value,
    marginal_tolerance_percent = excluded.marginal_tolerance_percent,
    unit = excluded.unit,
    compliant_rule = excluded.compliant_rule,
    marginal_rule = excluded.marginal_rule,
    noncompliant_rule = excluded.noncompliant_rule,
    updated_by = actor_id;

  delete from public.indicator_definition_processes relation
  where relation.indicator_id = saved_indicator_id;

  insert into public.indicator_definition_processes(indicator_id, process_id)
  select saved_indicator_id, process_id from unnest(normalized_process_ids) process_id
  on conflict do nothing;

  for period in select value from jsonb_array_elements(coalesce(requested_periods, '[]'::jsonb)) loop
    insert into public.indicator_periods (
      indicator_id, year, quarter, scheduled_date, opens_at, closes_at,
      created_by, updated_by
    ) values (
      saved_indicator_id,
      (period ->> 'year')::integer,
      (period ->> 'quarter')::public.quarter_code,
      (period ->> 'scheduledDate')::date,
      (period ->> 'opensAt')::timestamptz,
      (period ->> 'closesAt')::timestamptz,
      actor_id,
      actor_id
    )
    on conflict (indicator_id, year, quarter) do update set
      scheduled_date = excluded.scheduled_date,
      opens_at = excluded.opens_at,
      closes_at = excluded.closes_at,
      updated_by = actor_id;
  end loop;

  return saved_indicator_id;
end;
$$;

create or replace function public.disable_indicator_runtime(requested_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_organization_id uuid;
  actor_workspace_mode text;
  disabled_indicator_id uuid;
begin
  select profile.organization_id, profile.workspace_mode
  into actor_organization_id, actor_workspace_mode
  from public.profiles profile
  where profile.id = actor_id
    and profile.status = 'active'
    and profile.user_type = 'administrator';
  if actor_organization_id is null then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;

  update public.indicator_definitions definition
  set active = false, updated_by = actor_id
  where definition.organization_id = actor_organization_id
    and definition.workspace_mode = actor_workspace_mode
    and definition.code = trim(requested_code)
  returning definition.id into disabled_indicator_id;

  if disabled_indicator_id is null then
    raise exception using errcode = 'P0002', message = 'INDICATOR_NOT_FOUND';
  end if;
  return disabled_indicator_id;
end;
$$;

drop policy if exists indicators_select_process on public.indicator_definitions;
create policy indicators_select_process on public.indicator_definitions
for select to authenticated
using (
  workspace_mode = public.current_workspace_mode()
  and organization_id in (select public.current_organization_ids())
  and public.has_module_permission('indicators', 'view')
  and public.can_access_indicator(id)
);

drop policy if exists indicators_admin_write on public.indicator_definitions;
create policy indicators_admin_write on public.indicator_definitions
for all to authenticated
using (
  public.is_administrator()
  and workspace_mode = public.current_workspace_mode()
  and organization_id in (select public.current_organization_ids())
)
with check (
  public.is_administrator()
  and workspace_mode = public.current_workspace_mode()
  and organization_id in (select public.current_organization_ids())
);

drop policy if exists indicator_rules_select_process on public.indicator_evaluation_rules;
create policy indicator_rules_select_process on public.indicator_evaluation_rules
for select to authenticated
using (exists (
  select 1 from public.indicator_definitions definition
  where definition.id = indicator_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.can_access_indicator(definition.id)
));

drop policy if exists indicator_rules_admin_write on public.indicator_evaluation_rules;
create policy indicator_rules_admin_write on public.indicator_evaluation_rules
for all to authenticated
using (exists (
  select 1 from public.indicator_definitions definition
  where definition.id = indicator_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.is_administrator()
))
with check (exists (
  select 1 from public.indicator_definitions definition
  where definition.id = indicator_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.is_administrator()
));

drop policy if exists indicator_definition_processes_select_scope on public.indicator_definition_processes;
create policy indicator_definition_processes_select_scope on public.indicator_definition_processes
for select to authenticated
using (exists (
  select 1 from public.indicator_definitions definition
  where definition.id = indicator_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.can_access_indicator(definition.id)
));

drop policy if exists indicator_definition_processes_admin_manage on public.indicator_definition_processes;
create policy indicator_definition_processes_admin_manage on public.indicator_definition_processes
for all to authenticated
using (exists (
  select 1 from public.indicator_definitions definition
  where definition.id = indicator_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.is_administrator()
))
with check (exists (
  select 1 from public.indicator_definitions definition
  where definition.id = indicator_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.is_administrator()
));

drop policy if exists indicator_periods_select_process on public.indicator_periods;
create policy indicator_periods_select_process on public.indicator_periods
for select to authenticated
using (exists (
  select 1 from public.indicator_definitions definition
  where definition.id = indicator_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.can_access_indicator(definition.id)
));

drop policy if exists indicator_periods_admin_write on public.indicator_periods;
create policy indicator_periods_admin_write on public.indicator_periods
for all to authenticated
using (exists (
  select 1 from public.indicator_definitions definition
  where definition.id = indicator_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.is_administrator()
))
with check (exists (
  select 1 from public.indicator_definitions definition
  where definition.id = indicator_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.is_administrator()
));

drop policy if exists indicator_results_select_process on public.indicator_results;
create policy indicator_results_select_process on public.indicator_results
for select to authenticated
using (exists (
  select 1
  from public.indicator_periods period
  join public.indicator_definitions definition on definition.id = period.indicator_id
  where period.id = period_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.can_access_indicator(definition.id)
));

drop policy if exists indicator_results_insert_window on public.indicator_results;
create policy indicator_results_insert_window on public.indicator_results
for insert to authenticated
with check (
  submitted_by = auth.uid()
  and exists (
    select 1
    from public.indicator_periods period
    join public.indicator_definitions definition on definition.id = period.indicator_id
    where period.id = period_id
      and definition.workspace_mode = public.current_workspace_mode()
      and definition.organization_id in (select public.current_organization_ids())
      and public.can_modify_indicator(definition.id)
      and public.has_module_permission('indicators', 'update')
      and (public.is_administrator() or now() between period.opens_at and period.closes_at)
  )
);

drop policy if exists indicator_results_update_window on public.indicator_results;
create policy indicator_results_update_window on public.indicator_results
for update to authenticated
using (exists (
  select 1
  from public.indicator_periods period
  join public.indicator_definitions definition on definition.id = period.indicator_id
  where period.id = period_id
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids())
    and public.can_modify_indicator(definition.id)
    and public.has_module_permission('indicators', 'update')
    and (public.is_administrator() or now() between period.opens_at and period.closes_at)
))
with check (
  (submitted_by = auth.uid() or public.is_administrator())
  and exists (
    select 1
    from public.indicator_periods period
    join public.indicator_definitions definition on definition.id = period.indicator_id
    where period.id = period_id
      and definition.workspace_mode = public.current_workspace_mode()
      and definition.organization_id in (select public.current_organization_ids())
      and public.can_modify_indicator(definition.id)
      and public.has_module_permission('indicators', 'update')
      and (public.is_administrator() or now() between period.opens_at and period.closes_at)
  )
);

revoke all on function public.save_indicator_runtime(
  text, integer, text, text[], text, text, text, text, text, text,
  text, text, jsonb, jsonb
) from public;
grant execute on function public.save_indicator_runtime(
  text, integer, text, text[], text, text, text, text, text, text,
  text, text, jsonb, jsonb
) to authenticated;
revoke all on function public.disable_indicator_runtime(text) from public;
grant execute on function public.disable_indicator_runtime(text) to authenticated;

comment on column public.indicator_definitions.workspace_mode is
  'Aísla configuraciones demo y producción; el frontend nunca mezcla ambos ámbitos.';
comment on function public.save_indicator_runtime(
  text, integer, text, text[], text, text, text, text, text, text,
  text, text, jsonb, jsonb
) is 'Guarda atómicamente definición, reglas, procesos y periodos de un indicador.';

commit;
