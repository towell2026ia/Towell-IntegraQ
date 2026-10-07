-- IQ-PRD-IND-02: permisos funcionales de captura independientes del rol documental.

begin;

create or replace function public.can_modify_indicator(requested_indicator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_administrator() or (
    public.is_internal_user()
    and exists (
      select 1
      from public.indicator_definition_processes relation
      where relation.indicator_id = requested_indicator_id
        and public.has_process_access(relation.process_id)
    )
  );
$$;

create or replace function public.can_capture_indicator(requested_indicator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_administrator() or (
    public.is_internal_user()
    and public.has_module_permission('indicators', 'update')
    and exists (
      select 1
      from public.indicator_definition_processes relation
      where relation.indicator_id = requested_indicator_id
        and public.has_process_access(relation.process_id)
    )
  );
$$;

create or replace function public.indicator_capture_status(
  requested_code text,
  requested_year integer,
  requested_quarter public.quarter_code
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_indicator_id uuid;
  selected_opens_at timestamptz;
  selected_closes_at timestamptz;
begin
  select definition.id
  into selected_indicator_id
  from public.indicator_definitions definition
  where definition.code = trim(requested_code)
    and definition.active
    and definition.workspace_mode = public.current_workspace_mode()
    and definition.organization_id in (select public.current_organization_ids());

  if selected_indicator_id is null then
    return 'process';
  end if;
  if not public.is_administrator() and (
    not public.is_internal_user()
    or not exists (
      select 1
      from public.indicator_definition_processes relation
      where relation.indicator_id = selected_indicator_id
        and public.has_process_access(relation.process_id)
    )
  ) then
    return 'process';
  end if;
  if not public.is_administrator()
    and not public.has_module_permission('indicators', 'update') then
    return 'permission';
  end if;

  select period.opens_at, period.closes_at
  into selected_opens_at, selected_closes_at
  from public.indicator_periods period
  where period.indicator_id = selected_indicator_id
    and period.year = requested_year
    and period.quarter = requested_quarter;

  if selected_opens_at is null or selected_closes_at is null then
    return 'window';
  end if;
  if not public.is_administrator()
    and now() not between selected_opens_at and selected_closes_at then
    return 'window';
  end if;
  return 'allowed';
end;
$$;

create or replace function public.can_capture_indicator_evidence(
  requested_resource_key text,
  requested_process_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matched text[];
begin
  matched := regexp_match(requested_resource_key, '^([^:]+):([0-9]{4}):(Q[1-4])$');
  if matched is null then return false; end if;
  if public.indicator_capture_status(
    matched[1], (matched[2])::integer, (matched[3])::public.quarter_code
  ) <> 'allowed' then
    return false;
  end if;
  return exists (
    select 1
    from public.indicator_definitions definition
    join public.indicator_definition_processes relation
      on relation.indicator_id = definition.id
    where definition.code = matched[1]
      and definition.active
      and definition.workspace_mode = public.current_workspace_mode()
      and definition.organization_id in (select public.current_organization_ids())
      and relation.process_id = requested_process_id
      and public.has_process_access(relation.process_id)
  );
end;
$$;

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
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('indicators', 'update')
          and exists (
            select 1
            from public.indicator_definition_processes relation
            where relation.indicator_id = definition.id
              and public.has_process_access(relation.process_id)
          )
          and now() between period.opens_at and period.closes_at
        )
      )
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
    and (
      public.is_administrator()
      or (
        public.is_internal_user()
        and public.has_module_permission('indicators', 'update')
        and exists (
          select 1
          from public.indicator_definition_processes relation
          where relation.indicator_id = definition.id
            and public.has_process_access(relation.process_id)
        )
        and now() between period.opens_at and period.closes_at
      )
    )
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
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('indicators', 'update')
          and exists (
            select 1
            from public.indicator_definition_processes relation
            where relation.indicator_id = definition.id
              and public.has_process_access(relation.process_id)
          )
          and now() between period.opens_at and period.closes_at
        )
      )
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
  selected_opens_at timestamptz;
  selected_closes_at timestamptz;
begin
  select period.indicator_id, period.opens_at, period.closes_at
  into selected_indicator_id, selected_opens_at, selected_closes_at
  from public.indicator_periods period
  where period.id = new.period_id;

  if selected_indicator_id is null then
    raise exception using errcode = '22023', message = 'INDICATOR_PERIOD_INVALID';
  end if;
  if auth.uid() is not null and not public.is_administrator() then
    if not public.is_internal_user() or not exists (
      select 1
      from public.indicator_definition_processes relation
      where relation.indicator_id = selected_indicator_id
        and public.has_process_access(relation.process_id)
    ) then
      raise exception using errcode = '42501', message = 'INDICATOR_PROCESS_FORBIDDEN';
    end if;
    if not public.has_module_permission('indicators', 'update') then
      raise exception using errcode = '42501', message = 'INDICATOR_CAPTURE_PERMISSION_REQUIRED';
    end if;
    if now() < selected_opens_at or now() > selected_closes_at then
      raise exception using errcode = '42501', message = 'INDICATOR_CAPTURE_WINDOW_CLOSED';
    end if;
  end if;

  new.evaluation_status := public.evaluate_indicator_value(selected_indicator_id, new.value);
  new.submitted_by := coalesce(auth.uid(), new.submitted_by);
  new.submitted_at := now();
  return new;
end;
$$;

drop policy if exists file_objects_insert_scope on public.file_objects;
create policy file_objects_insert_scope on public.file_objects
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and (
    public.is_administrator()
    or (
      public.is_internal_user()
      and case
        when resource_type = 'indicator_result' then
          module_id = 'indicators'
          and process_id is not null
          and public.can_capture_indicator_evidence(resource_key, process_id)
        else
          (process_id is not null and public.has_process_access(process_id))
          or (module_id is not null and public.has_module_permission(module_id, 'create'))
      end
    )
    or external_organization_id in (select public.current_organization_ids())
  )
);

revoke all on function public.can_capture_indicator(uuid) from public;
revoke all on function public.indicator_capture_status(text, integer, public.quarter_code) from public;
revoke all on function public.can_capture_indicator_evidence(text, text) from public;
grant execute on function public.can_capture_indicator(uuid) to authenticated;
grant execute on function public.indicator_capture_status(text, integer, public.quarter_code) to authenticated;
grant execute on function public.can_capture_indicator_evidence(text, text) to authenticated;

comment on function public.can_capture_indicator(uuid) is
  'Autoriza captura por pertenencia al proceso y permiso indicators:update; no consulta roles documentales.';

commit;
