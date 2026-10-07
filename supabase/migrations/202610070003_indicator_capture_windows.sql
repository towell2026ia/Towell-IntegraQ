-- IQ-PRD-IND-03: ventanas configurables con zona America/Mexico_City.
-- Conserva resultados históricos y sólo normaliza ventanas antiguas de un único día.

begin;

create table if not exists public.indicator_capture_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_mode text not null default 'production'
    check (workspace_mode in ('demo', 'production')),
  capture_days_after_close integer not null default 15
    check (capture_days_after_close between 1 and 90),
  business_timezone text not null default 'America/Mexico_City'
    check (business_timezone = 'America/Mexico_City'),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, workspace_mode)
);

drop trigger if exists indicator_capture_settings_set_updated_at on public.indicator_capture_settings;
create trigger indicator_capture_settings_set_updated_at
before update on public.indicator_capture_settings
for each row execute function public.set_updated_at();

insert into public.indicator_capture_settings(organization_id, workspace_mode)
select distinct definition.organization_id, definition.workspace_mode
from public.indicator_definitions definition
where definition.organization_id is not null
on conflict do nothing;

alter table public.indicator_capture_settings enable row level security;
create policy indicator_capture_settings_select_scope
on public.indicator_capture_settings for select to authenticated
using (
  public.is_internal_user()
  and organization_id in (select public.current_organization_ids())
  and workspace_mode = public.current_workspace_mode()
);
create policy indicator_capture_settings_admin_write
on public.indicator_capture_settings for all to authenticated
using (
  public.is_administrator()
  and organization_id in (select public.current_organization_ids())
  and workspace_mode = public.current_workspace_mode()
)
with check (
  public.is_administrator()
  and organization_id in (select public.current_organization_ids())
  and workspace_mode = public.current_workspace_mode()
);

grant select, insert, update on public.indicator_capture_settings to authenticated;

create or replace function public.default_indicator_capture_opens_at(
  requested_year integer,
  requested_quarter public.quarter_code,
  requested_timezone text default 'America/Mexico_City'
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  opening_year integer := requested_year;
  opening_month integer;
begin
  opening_month := case requested_quarter
    when 'Q1' then 4
    when 'Q2' then 7
    when 'Q3' then 10
    else 1
  end;
  if requested_quarter = 'Q4' then opening_year := requested_year + 1; end if;
  return make_timestamptz(opening_year, opening_month, 1, 0, 0, 0, requested_timezone);
end;
$$;

create or replace function public.default_indicator_capture_closes_at(
  requested_year integer,
  requested_quarter public.quarter_code,
  requested_days integer,
  requested_timezone text default 'America/Mexico_City'
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  closing_date date;
  opening_local timestamp;
begin
  opening_local := public.default_indicator_capture_opens_at(
    requested_year, requested_quarter, requested_timezone
  ) at time zone requested_timezone;
  closing_date := opening_local::date + greatest(1, least(90, requested_days)) - 1;
  return make_timestamptz(
    extract(year from closing_date)::integer,
    extract(month from closing_date)::integer,
    extract(day from closing_date)::integer,
    23, 59, 59.999999, requested_timezone
  );
end;
$$;

create or replace function public.apply_default_indicator_capture_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_days integer := 15;
  selected_timezone text := 'America/Mexico_City';
begin
  select
    coalesce(setting.capture_days_after_close, 15),
    coalesce(setting.business_timezone, 'America/Mexico_City')
  into selected_days, selected_timezone
  from public.indicator_definitions definition
  left join public.indicator_capture_settings setting
    on setting.organization_id = definition.organization_id
   and setting.workspace_mode = definition.workspace_mode
  where definition.id = new.indicator_id;

  if new.opens_at is null then
    new.opens_at := public.default_indicator_capture_opens_at(new.year, new.quarter, selected_timezone);
  end if;
  if new.closes_at is null then
    new.closes_at := public.default_indicator_capture_closes_at(new.year, new.quarter, selected_days, selected_timezone);
  end if;
  return new;
end;
$$;

drop trigger if exists indicator_periods_default_capture_window on public.indicator_periods;
create trigger indicator_periods_default_capture_window
before insert or update of year, quarter, opens_at, closes_at on public.indicator_periods
for each row execute function public.apply_default_indicator_capture_window();

-- Convierte únicamente la regla histórica de un solo día; no toca excepciones ni periodos con resultados.
update public.indicator_periods period
set opens_at = public.default_indicator_capture_opens_at(
      period.year, period.quarter, coalesce(setting.business_timezone, 'America/Mexico_City')
    ),
    closes_at = public.default_indicator_capture_closes_at(
      period.year, period.quarter, coalesce(setting.capture_days_after_close, 15),
      coalesce(setting.business_timezone, 'America/Mexico_City')
    ),
    updated_at = now()
from public.indicator_definitions definition
left join public.indicator_capture_settings setting
  on setting.organization_id = definition.organization_id
 and setting.workspace_mode = definition.workspace_mode
where definition.id = period.indicator_id
  and not exists (
    select 1 from public.indicator_results result where result.period_id = period.id
  )
  and (period.opens_at at time zone 'America/Mexico_City')::date = period.scheduled_date
  and (period.closes_at at time zone 'America/Mexico_City')::date = period.scheduled_date;

-- Garantiza el calendario del año actual y los dos siguientes sin borrar periodos previos.
insert into public.indicator_periods(
  indicator_id, year, quarter, scheduled_date, opens_at, closes_at, created_by
)
select
  definition.id,
  calendar.year,
  calendar.quarter,
  case calendar.quarter
    when 'Q1' then make_date(calendar.year, 3, 31)
    when 'Q2' then make_date(calendar.year, 6, 30)
    when 'Q3' then make_date(calendar.year, 9, 30)
    else make_date(calendar.year, 12, 31)
  end,
  null,
  null,
  definition.created_by
from public.indicator_definitions definition
cross join (
  select year, quarter
  from generate_series(
    extract(year from current_timestamp at time zone 'America/Mexico_City')::integer,
    extract(year from current_timestamp at time zone 'America/Mexico_City')::integer + 2
  ) year
  cross join unnest(enum_range(null::public.quarter_code)) quarter
) calendar
where definition.active
on conflict (indicator_id, year, quarter) do nothing;

create or replace function public.audit_indicator_period_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_definition public.indicator_definitions%rowtype;
begin
  if new.opens_at is not distinct from old.opens_at
    and new.closes_at is not distinct from old.closes_at then
    return new;
  end if;
  select * into selected_definition
  from public.indicator_definitions where id = new.indicator_id;
  insert into public.audit_log(
    actor_id, organization_id, module, action, resource_type, resource_id,
    entity_code_snapshot, previous_value, new_value, metadata
  ) values (
    coalesce(new.updated_by, auth.uid()), selected_definition.organization_id,
    'indicators', 'indicator_period.updated', 'indicator_period', new.id::text,
    selected_definition.code,
    jsonb_build_object('opens_at', old.opens_at, 'closes_at', old.closes_at),
    jsonb_build_object('opens_at', new.opens_at, 'closes_at', new.closes_at),
    jsonb_build_object('year', new.year, 'quarter', new.quarter, 'process_id', selected_definition.process_id)
  );
  return new;
end;
$$;

drop trigger if exists indicator_periods_audit_window on public.indicator_periods;
create trigger indicator_periods_audit_window
after update of opens_at, closes_at on public.indicator_periods
for each row execute function public.audit_indicator_period_window();

create or replace function public.audit_indicator_capture_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.capture_days_after_close is not distinct from old.capture_days_after_close then
    return new;
  end if;
  insert into public.audit_log(
    actor_id, organization_id, module, action, resource_type, resource_id,
    previous_value, new_value
  ) values (
    coalesce(new.updated_by, auth.uid()), new.organization_id, 'indicators',
    'indicator_capture_settings.updated', 'indicator_capture_settings',
    new.organization_id::text || ':' || new.workspace_mode,
    case when tg_op = 'UPDATE' then jsonb_build_object('capture_days_after_close', old.capture_days_after_close) else null end,
    jsonb_build_object('capture_days_after_close', new.capture_days_after_close, 'business_timezone', new.business_timezone)
  );
  return new;
end;
$$;

drop trigger if exists indicator_capture_settings_audit on public.indicator_capture_settings;
create trigger indicator_capture_settings_audit
after insert or update on public.indicator_capture_settings
for each row execute function public.audit_indicator_capture_settings();

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
  override_reason text := nullif(trim(current_setting('integraq.indicator_override_reason', true)), '');
begin
  select period.indicator_id, period.opens_at, period.closes_at
  into selected_indicator_id, selected_opens_at, selected_closes_at
  from public.indicator_periods period
  where period.id = new.period_id;

  if selected_indicator_id is null then
    raise exception using errcode = '22023', message = 'INDICATOR_PERIOD_INVALID';
  end if;
  if auth.uid() is not null and public.is_administrator() then
    if now() not between selected_opens_at and selected_closes_at
      and override_reason is null then
      raise exception using errcode = '22023', message = 'INDICATOR_ADMIN_OVERRIDE_REASON_REQUIRED';
    end if;
  elsif auth.uid() is not null then
    if not public.is_internal_user() or not exists (
      select 1 from public.indicator_definition_processes relation
      where relation.indicator_id = selected_indicator_id
        and public.has_process_access(relation.process_id)
    ) then
      raise exception using errcode = '42501', message = 'INDICATOR_PROCESS_FORBIDDEN';
    end if;
    if not public.has_module_permission('indicators', 'update') then
      raise exception using errcode = '42501', message = 'INDICATOR_CAPTURE_PERMISSION_REQUIRED';
    end if;
    if now() not between selected_opens_at and selected_closes_at then
      raise exception using errcode = '42501', message = 'INDICATOR_CAPTURE_WINDOW_CLOSED';
    end if;
  end if;

  new.evaluation_status := public.evaluate_indicator_value(selected_indicator_id, new.value);
  new.submitted_by := coalesce(auth.uid(), new.submitted_by);
  new.submitted_at := now();
  return new;
end;
$$;

create or replace function public.audit_indicator_result_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_period public.indicator_periods%rowtype;
  selected_definition public.indicator_definitions%rowtype;
  override_reason text := nullif(trim(current_setting('integraq.indicator_override_reason', true)), '');
  audit_action text;
begin
  select * into selected_period from public.indicator_periods where id = new.period_id;
  select * into selected_definition from public.indicator_definitions where id = selected_period.indicator_id;
  audit_action := case
    when override_reason is not null then 'indicator_result.admin_override'
    when tg_op = 'INSERT' then 'indicator_result.created'
    else 'indicator_result.updated'
  end;
  insert into public.audit_log(
    actor_id, organization_id, module, action, resource_type, resource_id,
    entity_code_snapshot, previous_value, new_value, reason, metadata
  ) values (
    new.submitted_by, selected_definition.organization_id, 'indicators', audit_action,
    'indicator_result', new.id::text, selected_definition.code,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'value', old.value, 'comments', old.comments, 'evidence_file_id', old.evidence_file_id
    ) else null end,
    jsonb_build_object(
      'value', new.value, 'comments', new.comments, 'evidence_file_id', new.evidence_file_id,
      'evaluation_status', new.evaluation_status
    ),
    override_reason,
    jsonb_build_object(
      'year', selected_period.year, 'quarter', selected_period.quarter,
      'process_id', selected_definition.process_id,
      'opens_at', selected_period.opens_at, 'closes_at', selected_period.closes_at
    )
  );
  return new;
end;
$$;

drop trigger if exists indicator_results_audit_change on public.indicator_results;
create trigger indicator_results_audit_change
after insert or update on public.indicator_results
for each row execute function public.audit_indicator_result_change();

create or replace function public.save_indicator_result_runtime(
  requested_period_id uuid,
  requested_value numeric,
  requested_comments text,
  requested_evidence_file_id uuid,
  requested_override_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  selected_period public.indicator_periods%rowtype;
  selected_definition public.indicator_definitions%rowtype;
  saved_result public.indicator_results%rowtype;
  override_reason text := nullif(trim(coalesce(requested_override_reason, '')), '');
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'SESSION_REQUIRED';
  end if;
  select * into selected_period from public.indicator_periods where id = requested_period_id;
  select * into selected_definition
  from public.indicator_definitions definition
  where definition.id = selected_period.indicator_id
    and definition.active
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids());
  if selected_definition.id is null then
    raise exception using errcode = '42501', message = 'INDICATOR_PROCESS_FORBIDDEN';
  end if;

  if public.is_administrator() then
    if now() not between selected_period.opens_at and selected_period.closes_at
      and override_reason is null then
      raise exception using errcode = '22023', message = 'INDICATOR_ADMIN_OVERRIDE_REASON_REQUIRED';
    end if;
  else
    if not public.is_internal_user() or not exists (
      select 1 from public.indicator_definition_processes relation
      where relation.indicator_id = selected_definition.id
        and public.has_process_access(relation.process_id)
    ) then
      raise exception using errcode = '42501', message = 'INDICATOR_PROCESS_FORBIDDEN';
    end if;
    if not public.has_module_permission('indicators', 'update') then
      raise exception using errcode = '42501', message = 'INDICATOR_CAPTURE_PERMISSION_REQUIRED';
    end if;
    if now() not between selected_period.opens_at and selected_period.closes_at then
      raise exception using errcode = '42501', message = 'INDICATOR_CAPTURE_WINDOW_CLOSED';
    end if;
  end if;

  if requested_evidence_file_id is not null and not exists (
    select 1 from public.file_objects file
    where file.id = requested_evidence_file_id
      and file.resource_type = 'indicator_result'
      and file.resource_key = selected_definition.code || ':' || selected_period.year || ':' || selected_period.quarter
      and file.deleted_at is null
  ) then
    raise exception using errcode = '22023', message = 'INDICATOR_EVIDENCE_INVALID';
  end if;

  perform set_config('integraq.indicator_override_reason', coalesce(override_reason, ''), true);
  insert into public.indicator_results(
    period_id, value, comments, evidence_file_id, submitted_by
  ) values (
    requested_period_id, requested_value, requested_comments,
    requested_evidence_file_id, actor_id
  )
  on conflict (period_id) do update set
    value = excluded.value,
    comments = excluded.comments,
    evidence_file_id = excluded.evidence_file_id,
    submitted_by = actor_id
  returning * into saved_result;

  return jsonb_build_object(
    'id', saved_result.id,
    'submitted_at', saved_result.submitted_at,
    'evaluation_status', saved_result.evaluation_status
  );
end;
$$;

revoke all on function public.save_indicator_result_runtime(uuid, numeric, text, uuid, text) from public;
grant execute on function public.save_indicator_result_runtime(uuid, numeric, text, uuid, text) to authenticated;

comment on table public.indicator_capture_settings is
  'Regla general por organización; las excepciones permanecen en indicator_periods.opens_at/closes_at.';

commit;
