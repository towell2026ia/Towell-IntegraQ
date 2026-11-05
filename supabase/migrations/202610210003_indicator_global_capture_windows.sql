-- IQ-ARCH-DEPLOY-01 / STB-01. Additive schema only; never invokes an operation.
begin;

alter table public.indicator_periods
  add column capture_rule_source text not null default 'legacy' check(capture_rule_source in ('legacy','global','exception')),
  add column capture_exception_reason text;
alter table public.indicator_periods add constraint indicator_period_exception_reason check(capture_rule_source<>'exception' or length(trim(coalesce(capture_exception_reason,'')))>0);
revoke insert,update,delete on public.indicator_capture_settings from authenticated;
create table public.indicator_capture_rules (
  organization_id uuid not null references public.organizations(id),
  workspace_mode text not null check(workspace_mode in ('production','demo')),
  year integer not null check(year between 2020 and 2200),
  quarter public.quarter_code not null,
  opens_at timestamptz not null, closes_at timestamptz not null,
  timezone text not null default 'America/Mexico_City' check(timezone='America/Mexico_City'),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(organization_id,workspace_mode,year,quarter), check(isfinite(opens_at) and isfinite(closes_at) and opens_at<=closes_at)
);
create table public.indicator_capture_operations (
  id uuid primary key, organization_id uuid not null references public.organizations(id),
  workspace_mode text not null, actor_id uuid not null references public.profiles(id),
  kind text not null check(kind in ('global','restore','exception')),
  reason text not null check(length(trim(reason)) between 1 and 1000),
  scope jsonb not null, include_exceptions boolean not null default false,
  before_preview jsonb not null, after_preview jsonb not null,
  restored_from uuid unique references public.indicator_capture_operations(id),
  created_at timestamptz not null default now()
);
alter table public.indicator_capture_rules enable row level security;
alter table public.indicator_capture_operations enable row level security;
create policy indicator_capture_rules_read on public.indicator_capture_rules for select to authenticated using(
  public.is_internal_user() and organization_id in(select public.current_organization_ids())
  and workspace_mode=public.current_workspace_mode()
  and (public.is_administrator() or public.has_module_permission('indicators','view'))
);
create policy indicator_capture_operations_read on public.indicator_capture_operations for select to authenticated using(
  public.is_administrator() and organization_id in(select public.current_organization_ids()) and workspace_mode=public.current_workspace_mode()
);
revoke all on public.indicator_capture_rules,public.indicator_capture_operations from anon,authenticated;
grant select on public.indicator_capture_rules,public.indicator_capture_operations to authenticated;
create function public.reject_capture_operation_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'CAPTURE_AUDIT_IMMUTABLE'; end; $$;
create trigger indicator_capture_operations_immutable before update or delete on public.indicator_capture_operations
for each row execute function public.reject_capture_operation_mutation();

create function public.require_capture_administrator() returns public.profiles
language plpgsql stable security definer set search_path='' as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active' and user_type='administrator' and organization_id is not null;
  if actor.id is null then raise exception using errcode='42501',message='CAPTURE_ADMIN_REQUIRED'; end if;
  if actor.workspace_mode is distinct from (select coalesce(raw_app_meta_data->>'workspace_mode','production') from auth.users where id=actor.id)
  then raise exception using errcode='42501',message='CAPTURE_WORKSPACE_MISMATCH'; end if;
  return actor;
end; $$;
revoke all on function public.require_capture_administrator() from public,anon,authenticated;

create function public.normalize_capture_scope(p_scope jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare s jsonb; normalized jsonb;
begin
  if jsonb_typeof(p_scope) is distinct from 'array' or jsonb_array_length(p_scope) not between 1 and 12 then raise exception 'CAPTURE_SCOPE_INVALID'; end if;
  for s in select value from jsonb_array_elements(p_scope) loop
    if (s->>'year')::integer not between 2020 and 2200 or s->>'quarter' not in ('Q1','Q2','Q3','Q4')
      or coalesce(s->>'opensAt','') !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(s->>'closesAt','') !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
      or not isfinite((s->>'opensAt')::timestamptz) or not isfinite((s->>'closesAt')::timestamptz)
      or (s->>'opensAt')::timestamptz>(s->>'closesAt')::timestamptz then raise exception 'CAPTURE_SCOPE_INVALID'; end if;
    if s->>'year' is null or s->>'quarter' is null then raise exception 'CAPTURE_SCOPE_INVALID'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_scope)) <> (select count(distinct (value->>'year',value->>'quarter')) from jsonb_array_elements(p_scope)) then raise exception 'CAPTURE_SCOPE_DUPLICATE'; end if;
  select jsonb_agg(jsonb_build_object('year',(value->>'year')::integer,'quarter',value->>'quarter','opensAt',(value->>'opensAt')::timestamptz,'closesAt',(value->>'closesAt')::timestamptz) order by (value->>'year')::integer,value->>'quarter') into normalized from jsonb_array_elements(p_scope);
  return normalized;
end; $$;
revoke all on function public.normalize_capture_scope(jsonb) from public,anon,authenticated;

create function public.preview_indicator_capture_windows(p_scope jsonb,p_include_exceptions boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.require_capture_administrator(); scope jsonb:=public.normalize_capture_scope(p_scope); rows jsonb; rules jsonb; snapshot jsonb; days integer;
begin
  if p_include_exceptions is null then raise exception 'CAPTURE_SCOPE_INVALID'; end if;
  select coalesce((select capture_days_after_close from public.indicator_capture_settings where organization_id=actor.organization_id and workspace_mode=actor.workspace_mode),15) into days;
  select coalesce(jsonb_agg(jsonb_build_object(
    'indicatorId',d.id,'code',d.code,'name',d.name,'processId',d.process_id,'year',(s->>'year')::integer,'quarter',s->>'quarter',
    'periodId',p.id,'updatedAt',p.updated_at,'source',coalesce(p.capture_rule_source,'global'),'exceptionReason',p.capture_exception_reason,
    'opensBefore',p.opens_at,'closesBefore',p.closes_at,'opensAfter',(s->>'opensAt')::timestamptz,'closesAfter',(s->>'closesAt')::timestamptz,
    'preserved',coalesce(p.capture_rule_source='exception' and not p_include_exceptions,false)
  ) order by d.code,(s->>'year')::integer,s->>'quarter'),'[]') into rows
  from public.indicator_definitions d cross join jsonb_array_elements(scope) s
  left join public.indicator_periods p on p.indicator_id=d.id and p.year=(s->>'year')::integer and p.quarter=(s->>'quarter')::public.quarter_code
  where d.active and d.organization_id=actor.organization_id and d.workspace_mode=actor.workspace_mode;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.year,r.quarter),'[]') into rules from public.indicator_capture_rules r
  where r.organization_id=actor.organization_id and r.workspace_mode=actor.workspace_mode
    and exists(select 1 from jsonb_array_elements(scope) s where (s->>'year')::integer=r.year and (s->>'quarter')::public.quarter_code=r.quarter);
  snapshot:=jsonb_build_object('scope',scope,'rows',rows,'rules',rules,'defaultDays',days,'includeExceptions',p_include_exceptions);
  return snapshot||jsonb_build_object(
    'token',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),
    'indicators',(select count(distinct value->>'indicatorId') from jsonb_array_elements(rows)),
    'windows',(select count(*) from jsonb_array_elements(rows) where not (value->>'preserved')::boolean),
    'exceptions',(select count(*) from jsonb_array_elements(rows) where (value->>'preserved')::boolean)
  );
end; $$;
revoke all on function public.preview_indicator_capture_windows(jsonb,boolean) from public,anon;
grant execute on function public.preview_indicator_capture_windows(jsonb,boolean) to authenticated;

-- New indicators inherit the effective rule. Existing rows are not changed by this migration.
create or replace function public.apply_default_indicator_capture_window() returns trigger
language plpgsql security definer set search_path='' as $$
declare d public.indicator_definitions; r public.indicator_capture_rules; days integer;
begin
  select * into d from public.indicator_definitions where id=new.indicator_id;
  perform pg_advisory_xact_lock(hashtextextended(d.organization_id::text||':'||d.workspace_mode,0));
  if tg_op='UPDATE' then
    if (new.indicator_id,new.year,new.quarter) is distinct from (old.indicator_id,old.year,old.quarter) then raise exception 'CAPTURE_PERIOD_IDENTITY_IMMUTABLE'; end if;
    if (new.opens_at,new.closes_at,new.capture_rule_source,new.capture_exception_reason) is distinct from (old.opens_at,old.closes_at,old.capture_rule_source,old.capture_exception_reason)
      and coalesce(current_setting('integraq.capture_write',true),'')<>'authorized' then raise exception 'CAPTURE_USE_ADMIN_OPERATION'; end if;
    return new;
  end if;
  if coalesce(current_setting('integraq.capture_write',true),'')='authorized' then return new; end if;
  select * into r from public.indicator_capture_rules where organization_id=d.organization_id and workspace_mode=d.workspace_mode and year=new.year and quarter=new.quarter;
  select coalesce((select capture_days_after_close from public.indicator_capture_settings where organization_id=d.organization_id and workspace_mode=d.workspace_mode),15) into days;
  new.opens_at:=coalesce(r.opens_at,public.default_indicator_capture_opens_at(new.year,new.quarter));
  new.closes_at:=coalesce(r.closes_at,public.default_indicator_capture_closes_at(new.year,new.quarter,days));
  new.capture_rule_source:='global';new.capture_exception_reason:=null;
  return new;
end; $$;
drop trigger indicator_periods_default_capture_window on public.indicator_periods;
create trigger indicator_periods_default_capture_window before insert or update of indicator_id,year,quarter,opens_at,closes_at,capture_rule_source,capture_exception_reason on public.indicator_periods for each row execute function public.apply_default_indicator_capture_window();

create function public.apply_indicator_capture_windows(p_scope jsonb,p_include_exceptions boolean,p_token text,p_operation uuid,p_reason text,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.require_capture_administrator(); before_state jsonb; after_state jsonb; s jsonb; existing public.indicator_capture_operations;
begin
  if p_confirmed is distinct from true or length(trim(coalesce(p_reason,''))) not between 1 and 1000 or p_operation is null then raise exception 'CAPTURE_CONFIRMATION_REQUIRED'; end if;
  lock table public.indicator_definitions in share mode;
  perform pg_advisory_xact_lock(hashtextextended(actor.organization_id::text||':'||actor.workspace_mode,0));
  select * into existing from public.indicator_capture_operations where id=p_operation;
  if existing.id is not null then
    if existing.organization_id<>actor.organization_id or existing.workspace_mode<>actor.workspace_mode or existing.actor_id<>actor.id or existing.kind<>'global'
      or existing.scope<>public.normalize_capture_scope(p_scope) or existing.include_exceptions is distinct from p_include_exceptions or existing.reason<>trim(p_reason)
      or existing.before_preview->>'token' is distinct from p_token then raise exception 'CAPTURE_OPERATION_CONFLICT'; end if;
    return jsonb_build_object('operationId',existing.id,'preview',existing.after_preview,'replayed',true);
  end if;
  before_state:=public.preview_indicator_capture_windows(p_scope,p_include_exceptions);
  if before_state->>'token' is distinct from p_token then raise exception 'CAPTURE_PREVIEW_STALE'; end if;
  if (before_state->>'indicators')::integer=0 then raise exception 'CAPTURE_NO_INDICATORS'; end if;
  perform set_config('integraq.capture_write','authorized',true);
  for s in select value from jsonb_array_elements(before_state->'scope') loop
    insert into public.indicator_capture_rules(organization_id,workspace_mode,year,quarter,opens_at,closes_at,updated_by)
    values(actor.organization_id,actor.workspace_mode,(s->>'year')::integer,(s->>'quarter')::public.quarter_code,(s->>'opensAt')::timestamptz,(s->>'closesAt')::timestamptz,actor.id)
    on conflict(organization_id,workspace_mode,year,quarter) do update set opens_at=excluded.opens_at,closes_at=excluded.closes_at,updated_by=actor.id,updated_at=now();
    insert into public.indicator_periods(indicator_id,year,quarter,scheduled_date,opens_at,closes_at,created_by,updated_by,capture_rule_source,capture_exception_reason)
    select d.id,(s->>'year')::integer,(s->>'quarter')::public.quarter_code,
      (public.default_indicator_capture_opens_at((s->>'year')::integer,(s->>'quarter')::public.quarter_code) at time zone 'America/Mexico_City')::date-1,
      (s->>'opensAt')::timestamptz,(s->>'closesAt')::timestamptz,actor.id,actor.id,'global',null
    from public.indicator_definitions d where d.active and d.organization_id=actor.organization_id and d.workspace_mode=actor.workspace_mode
    on conflict(indicator_id,year,quarter) do update set opens_at=excluded.opens_at,closes_at=excluded.closes_at,updated_by=actor.id,capture_rule_source='global',capture_exception_reason=null
    where public.indicator_periods.capture_rule_source<>'exception' or p_include_exceptions;
  end loop;
  perform set_config('integraq.capture_write','',true);
  after_state:=public.preview_indicator_capture_windows(p_scope,p_include_exceptions);
  insert into public.indicator_capture_operations(id,organization_id,workspace_mode,actor_id,kind,reason,scope,include_exceptions,before_preview,after_preview)
  values(p_operation,actor.organization_id,actor.workspace_mode,actor.id,'global',trim(p_reason),before_state->'scope',p_include_exceptions,before_state,after_state);
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,previous_value,new_value,reason,metadata)
  values(actor.id,actor.organization_id,'indicators','indicator_capture.global_applied','indicator_capture_operation',p_operation::text,before_state,after_state,trim(p_reason),jsonb_build_object('workspace_mode',actor.workspace_mode,'scope',before_state->'scope'));
  return jsonb_build_object('operationId',p_operation,'preview',after_state,'replayed',false);
end; $$;
revoke all on function public.apply_indicator_capture_windows(jsonb,boolean,text,uuid,text,boolean) from public,anon;
grant execute on function public.apply_indicator_capture_windows(jsonb,boolean,text,uuid,text,boolean) to authenticated;

create function public.restore_indicator_capture_windows(p_operation uuid,p_token text,p_reason text,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.require_capture_administrator(); original public.indicator_capture_operations; replay public.indicator_capture_operations; current_state jsonb; restored jsonb; entry jsonb; rule jsonb; new_id uuid:=gen_random_uuid();
begin
  if p_confirmed is distinct from true or length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'CAPTURE_CONFIRMATION_REQUIRED'; end if;
  lock table public.indicator_definitions in share mode;
  perform pg_advisory_xact_lock(hashtextextended(actor.organization_id::text||':'||actor.workspace_mode,0));
  select * into original from public.indicator_capture_operations where id=p_operation and organization_id=actor.organization_id and workspace_mode=actor.workspace_mode and kind='global';
  if original.id is null then raise exception 'CAPTURE_OPERATION_NOT_FOUND'; end if;
  select * into replay from public.indicator_capture_operations where restored_from=p_operation;
  if replay.id is not null then return jsonb_build_object('operationId',replay.id,'preview',replay.after_preview,'replayed',true); end if;
  current_state:=public.preview_indicator_capture_windows(original.scope,original.include_exceptions);
  if current_state->>'token' is distinct from p_token or p_token is distinct from original.after_preview->>'token' then raise exception 'CAPTURE_RECOVERY_CONFLICT'; end if;
  perform set_config('integraq.capture_write','authorized',true);
  delete from public.indicator_capture_rules r where r.organization_id=actor.organization_id and r.workspace_mode=actor.workspace_mode
    and exists(select 1 from jsonb_array_elements(original.scope) s where (s->>'year')::integer=r.year and (s->>'quarter')::public.quarter_code=r.quarter);
  for rule in select value from jsonb_array_elements(original.before_preview->'rules') loop
    insert into public.indicator_capture_rules select * from jsonb_populate_record(null::public.indicator_capture_rules,rule);
  end loop;
  for entry in select value from jsonb_array_elements(original.before_preview->'rows') loop
    update public.indicator_periods p set
      opens_at=coalesce((entry->>'opensBefore')::timestamptz,(select r.opens_at from public.indicator_capture_rules r where r.organization_id=actor.organization_id and r.workspace_mode=actor.workspace_mode and r.year=p.year and r.quarter=p.quarter),public.default_indicator_capture_opens_at(p.year,p.quarter)),
      closes_at=coalesce((entry->>'closesBefore')::timestamptz,(select r.closes_at from public.indicator_capture_rules r where r.organization_id=actor.organization_id and r.workspace_mode=actor.workspace_mode and r.year=p.year and r.quarter=p.quarter),public.default_indicator_capture_closes_at(p.year,p.quarter,(original.before_preview->>'defaultDays')::integer)),
      capture_rule_source=case when entry->>'periodId' is null then 'global' else entry->>'source' end,capture_exception_reason=entry->>'exceptionReason',updated_by=actor.id
    where p.indicator_id=(entry->>'indicatorId')::uuid and p.year=(entry->>'year')::integer and p.quarter=(entry->>'quarter')::public.quarter_code;
  end loop;
  perform set_config('integraq.capture_write','',true);
  restored:=public.preview_indicator_capture_windows(original.scope,original.include_exceptions);
  insert into public.indicator_capture_operations(id,organization_id,workspace_mode,actor_id,kind,reason,scope,include_exceptions,before_preview,after_preview,restored_from)
  values(new_id,actor.organization_id,actor.workspace_mode,actor.id,'restore',trim(p_reason),original.scope,original.include_exceptions,current_state,restored,p_operation);
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,previous_value,new_value,reason,metadata)
  values(actor.id,actor.organization_id,'indicators','indicator_capture.global_restored','indicator_capture_operation',new_id::text,current_state,restored,trim(p_reason),jsonb_build_object('restored_operation',p_operation));
  return jsonb_build_object('operationId',new_id,'preview',restored,'replayed',false);
end; $$;
revoke all on function public.restore_indicator_capture_windows(uuid,text,text,boolean) from public,anon;
grant execute on function public.restore_indicator_capture_windows(uuid,text,text,boolean) to authenticated;

-- Realtime invalidation only; the application re-reads authorized effective periods.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='indicator_periods') then alter publication supabase_realtime add table public.indicator_periods; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='indicator_capture_rules') then alter publication supabase_realtime add table public.indicator_capture_rules; end if;
  end if;
end; $$;

create function public.set_indicator_capture_exception(p_period uuid,p_expected timestamptz,p_opens timestamptz,p_closes timestamptz,p_inherit boolean,p_reason text,p_confirmed boolean,p_operation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=public.require_capture_administrator(); period public.indicator_periods; definition public.indicator_definitions; rule public.indicator_capture_rules; before_state jsonb; after_state jsonb; request_scope jsonb; replay public.indicator_capture_operations; days integer;
begin
  if p_confirmed is distinct from true or p_operation is null or p_inherit is null or length(trim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'CAPTURE_CONFIRMATION_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor.organization_id::text||':'||actor.workspace_mode,0));
  request_scope:=jsonb_build_object('periodId',p_period,'expected',p_expected,'opensAt',p_opens,'closesAt',p_closes,'inherit',p_inherit);
  select * into replay from public.indicator_capture_operations where id=p_operation;
  if replay.id is not null then
    if replay.actor_id<>actor.id or replay.organization_id<>actor.organization_id or replay.workspace_mode<>actor.workspace_mode or replay.kind<>'exception' or replay.scope<>request_scope or replay.reason<>trim(p_reason) then raise exception 'CAPTURE_OPERATION_CONFLICT'; end if;
    return jsonb_build_object('operationId',replay.id,'replayed',true);
  end if;
  select p.* into period from public.indicator_periods p join public.indicator_definitions d on d.id=p.indicator_id
    where p.id=p_period and d.active and d.organization_id=actor.organization_id and d.workspace_mode=actor.workspace_mode for update of p;
  if period.id is null then raise exception using errcode='42501',message='CAPTURE_PERIOD_FORBIDDEN'; end if;
  if p_expected is null or period.updated_at is distinct from p_expected then raise exception 'CAPTURE_PREVIEW_STALE'; end if;
  if not p_inherit and (p_opens is null or p_closes is null or not isfinite(p_opens) or not isfinite(p_closes) or p_opens>p_closes) then raise exception 'CAPTURE_SCOPE_INVALID'; end if;
  before_state:=to_jsonb(period);
  if p_inherit then
    select * into rule from public.indicator_capture_rules where organization_id=actor.organization_id and workspace_mode=actor.workspace_mode and year=period.year and quarter=period.quarter;
    select coalesce((select capture_days_after_close from public.indicator_capture_settings where organization_id=actor.organization_id and workspace_mode=actor.workspace_mode),15) into days;
    p_opens:=coalesce(rule.opens_at,public.default_indicator_capture_opens_at(period.year,period.quarter));
    p_closes:=coalesce(rule.closes_at,public.default_indicator_capture_closes_at(period.year,period.quarter,days));
  end if;
  perform set_config('integraq.capture_write','authorized',true);
  update public.indicator_periods set opens_at=p_opens,closes_at=p_closes,capture_rule_source=case when p_inherit then 'global' else 'exception' end,capture_exception_reason=case when p_inherit then null else trim(p_reason) end,updated_by=actor.id where id=p_period returning to_jsonb(indicator_periods.*) into after_state;
  perform set_config('integraq.capture_write','',true);
  insert into public.indicator_capture_operations(id,organization_id,workspace_mode,actor_id,kind,reason,scope,before_preview,after_preview)
    values(p_operation,actor.organization_id,actor.workspace_mode,actor.id,'exception',trim(p_reason),request_scope,before_state,after_state);
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id,previous_value,new_value,reason)
    values(actor.id,actor.organization_id,'indicators',case when p_inherit then 'indicator_capture.exception_removed' else 'indicator_capture.exception_set' end,'indicator_period',p_period::text,before_state,after_state,trim(p_reason));
  return jsonb_build_object('operationId',p_operation,'replayed',false);
end; $$;
revoke all on function public.set_indicator_capture_exception(uuid,timestamptz,timestamptz,timestamptz,boolean,text,boolean,uuid) from public,anon;
grant execute on function public.set_indicator_capture_exception(uuid,timestamptz,timestamptz,timestamptz,boolean,text,boolean,uuid) to authenticated;

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
  where period.id = new.period_id for share;

  if selected_indicator_id is null then
    raise exception using errcode = '22023', message = 'INDICATOR_PERIOD_INVALID';
  end if;
  if auth.uid() is not null and public.is_administrator() then
    if clock_timestamp() not between selected_opens_at and selected_closes_at
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
    if clock_timestamp() not between selected_opens_at and selected_closes_at then
      raise exception using errcode = '42501', message = 'INDICATOR_CAPTURE_WINDOW_CLOSED';
    end if;
  end if;

  new.evaluation_status := public.evaluate_indicator_value(selected_indicator_id, new.value);
  new.submitted_by := coalesce(auth.uid(), new.submitted_by);
  new.submitted_at := now();
  return new;
end;
$$;

-- Catalog updates cannot overwrite effective windows or individual exceptions.
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
      updated_by = actor_id;
  end loop;

  return saved_indicator_id;
end;
$$;

create function public.inherit_indicator_capture_rules() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.indicator_periods(indicator_id,year,quarter,scheduled_date,opens_at,closes_at,created_by,updated_by)
  select new.id,r.year,r.quarter,(public.default_indicator_capture_opens_at(r.year,r.quarter) at time zone 'America/Mexico_City')::date-1,
    r.opens_at,r.closes_at,coalesce(new.created_by,r.updated_by),r.updated_by
  from public.indicator_capture_rules r where r.organization_id=new.organization_id and r.workspace_mode=new.workspace_mode
  on conflict(indicator_id,year,quarter) do nothing;
  return new;
end; $$;
create trigger indicator_definitions_inherit_capture after insert on public.indicator_definitions for each row execute function public.inherit_indicator_capture_rules();
commit;
