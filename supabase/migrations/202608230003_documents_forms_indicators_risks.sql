-- IntegraQ: información documentada, formularios, indicadores y riesgos.
-- Requiere 202608230001 y 202608230002.

create type public.controlled_document_status as enum (
  'draft', 'pending', 'current', 'rejected', 'obsolete'
);
create type public.document_workflow_action as enum (
  'created', 'uploaded', 'submitted', 'approved', 'rejected', 'obsoleted'
);
create type public.form_definition_status as enum ('draft', 'active', 'retired');
create type public.form_source_type as enum ('manual', 'excel', 'image');
create type public.form_import_status as enum (
  'queued', 'processing', 'ready', 'failed', 'accepted'
);
create type public.quarter_code as enum ('Q1', 'Q2', 'Q3', 'Q4');
create type public.indicator_result_status as enum (
  'compliant', 'marginal', 'noncompliant'
);
create type public.indicator_rule_type as enum (
  'minimum', 'maximum', 'range', 'exact'
);
create type public.risk_kind as enum ('risk', 'opportunity');
create type public.risk_status as enum (
  'identified', 'assessing', 'treating', 'monitoring', 'closed'
);

create table public.document_types (
  id text primary key,
  name text not null unique,
  description text,
  sort_order smallint not null,
  active boolean not null default true
);

create table public.controlled_documents (
  id uuid primary key default gen_random_uuid(),
  process_id text not null references public.processes(id) on delete restrict,
  document_type_id text not null references public.document_types(id) on delete restrict,
  code text not null unique,
  title text not null,
  description text,
  owner_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.controlled_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.controlled_documents(id) on delete cascade,
  revision integer not null check (revision >= 0),
  status public.controlled_document_status not null default 'draft',
  file_id uuid references public.file_objects(id) on delete restrict,
  file_name text not null,
  change_reason text not null,
  uploaded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  validator_id uuid references public.profiles(id) on delete set null,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  authorized_by uuid references public.profiles(id) on delete set null,
  authorized_at timestamptz,
  rejected_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, revision)
);

create unique index controlled_document_current_version_idx
  on public.controlled_document_versions(document_id)
  where status = 'current';
create index controlled_documents_process_type_idx
  on public.controlled_documents(process_id, document_type_id);
create index controlled_document_versions_status_idx
  on public.controlled_document_versions(status, updated_at desc);

create table public.document_workflow_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.controlled_documents(id) on delete cascade,
  version_id uuid not null references public.controlled_document_versions(id) on delete cascade,
  action public.document_workflow_action not null,
  actor_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  comment text,
  created_at timestamptz not null default now()
);

create trigger controlled_documents_set_updated_at
before update on public.controlled_documents
for each row execute function public.set_updated_at();
create trigger controlled_document_versions_set_updated_at
before update on public.controlled_document_versions
for each row execute function public.set_updated_at();

create or replace function public.submit_document_version(requested_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_process_id text;
  selected_document_id uuid;
begin
  select d.process_id, d.id
  into selected_process_id, selected_document_id
  from public.controlled_document_versions v
  join public.controlled_documents d on d.id = v.document_id
  where v.id = requested_version_id and v.status in ('draft', 'rejected')
  for update of v;

  if selected_document_id is null then
    raise exception 'La versión no está disponible para envío.';
  end if;
  if not public.has_process_document_role(selected_process_id, 'modifier') then
    raise exception 'No cuenta con permiso para enviar esta versión.';
  end if;

  update public.controlled_document_versions
  set status = 'pending', submitted_by = auth.uid(), submitted_at = now(),
      rejection_reason = null, rejected_by = null, rejected_at = null
  where id = requested_version_id;

  insert into public.document_workflow_events (
    document_id, version_id, action, actor_id
  ) values (
    selected_document_id, requested_version_id, 'submitted', auth.uid()
  );
  return requested_version_id;
end;
$$;

create or replace function public.review_document_version(
  requested_version_id uuid,
  decision text,
  review_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_process_id text;
  selected_document_id uuid;
begin
  if decision not in ('approve', 'reject') then
    raise exception 'Decisión inválida.';
  end if;

  select d.process_id, d.id
  into selected_process_id, selected_document_id
  from public.controlled_document_versions v
  join public.controlled_documents d on d.id = v.document_id
  where v.id = requested_version_id and v.status = 'pending'
  for update of v;

  if selected_document_id is null then
    raise exception 'La versión no está pendiente de autorización.';
  end if;
  if not public.has_process_document_role(selected_process_id, 'authorizer') then
    raise exception 'No cuenta con permiso para autorizar esta versión.';
  end if;

  if decision = 'approve' then
    update public.controlled_document_versions
    set status = 'obsolete'
    where document_id = selected_document_id and status = 'current';

    update public.controlled_document_versions
    set status = 'current', validator_id = auth.uid(),
        authorized_by = auth.uid(), authorized_at = now(),
        rejection_reason = null
    where id = requested_version_id;
  else
    if nullif(trim(review_comment), '') is null then
      raise exception 'El motivo de rechazo es obligatorio.';
    end if;
    update public.controlled_document_versions
    set status = 'rejected', validator_id = auth.uid(),
        rejected_by = auth.uid(), rejected_at = now(),
        rejection_reason = review_comment
    where id = requested_version_id;
  end if;

  insert into public.document_workflow_events (
    document_id, version_id, action, actor_id, comment
  ) values (
    selected_document_id,
    requested_version_id,
    case when decision = 'approve'
      then 'approved'::public.document_workflow_action
      else 'rejected'::public.document_workflow_action end,
    auth.uid(),
    review_comment
  );
  return requested_version_id;
end;
$$;

create table public.form_definitions (
  id uuid primary key default gen_random_uuid(),
  registration_number text not null unique,
  name text not null,
  process_id text not null references public.processes(id) on delete restrict,
  controlled_document_id uuid unique references public.controlled_documents(id) on delete set null,
  version integer not null default 1 check (version > 0),
  status public.form_definition_status not null default 'draft',
  source_type public.form_source_type not null default 'manual',
  source_file_id uuid references public.file_objects(id) on delete set null,
  generated_component_code text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.form_definitions(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null check (
    field_type in ('text', 'number', 'date', 'select', 'textarea', 'checkbox', 'file')
  ),
  required boolean not null default false,
  unit text,
  options jsonb not null default '[]'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  sort_order integer not null,
  unique (form_id, field_key)
);

create table public.form_records (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.form_definitions(id) on delete restrict,
  record_number text not null unique,
  status text not null default 'draft',
  values jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.form_dashboard_definitions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.form_definitions(id) on delete cascade,
  version integer not null check (version > 0),
  agent_name text not null,
  objective text not null,
  category_field_key text,
  metric_field_key text,
  trend_field_key text,
  layout jsonb not null default '{}'::jsonb,
  generated_component_code text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (form_id, version)
);

create table public.form_dashboard_insights (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.form_dashboard_definitions(id) on delete cascade,
  insight_key text not null,
  label text not null,
  kind text not null check (kind in ('average', 'sum', 'rate', 'count', 'top')),
  field_key text not null,
  match_value text,
  attention_below numeric,
  attention_above numeric,
  sort_order integer not null,
  unique (dashboard_id, insight_key)
);

create table public.form_import_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type public.form_source_type not null check (source_type in ('excel', 'image')),
  source_file_id uuid not null references public.file_objects(id) on delete restrict,
  process_id text references public.processes(id) on delete restrict,
  status public.form_import_status not null default 'queued',
  interpreted_schema jsonb,
  error_message text,
  requested_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  accepted_form_id uuid references public.form_definitions(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create trigger form_definitions_set_updated_at
before update on public.form_definitions
for each row execute function public.set_updated_at();
create trigger form_records_set_updated_at
before update on public.form_records
for each row execute function public.set_updated_at();

create table public.indicator_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  source_row integer,
  process_id text not null references public.processes(id) on delete restrict,
  area text not null,
  direction_objective text,
  direction_metric text,
  quality_objective text,
  name text not null,
  leader_id uuid references public.profiles(id) on delete set null,
  leader_name text,
  metric_label text not null,
  description text,
  periodicity text not null default 'quarterly' check (periodicity = 'quarterly'),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.indicator_evaluation_rules (
  indicator_id uuid primary key references public.indicator_definitions(id) on delete cascade,
  rule_type public.indicator_rule_type not null,
  target_min numeric,
  target_max numeric,
  target_value numeric,
  marginal_tolerance_percent numeric not null default 5
    check (marginal_tolerance_percent >= 0),
  unit text not null default 'value',
  compliant_rule text not null,
  marginal_rule text not null,
  noncompliant_rule text not null,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint indicator_rule_values check (
    (rule_type = 'minimum' and target_min is not null)
    or (rule_type = 'maximum' and target_max is not null)
    or (rule_type = 'range' and target_min is not null and target_max is not null and target_min <= target_max)
    or (rule_type = 'exact' and target_value is not null)
  )
);

create table public.indicator_periods (
  id uuid primary key default gen_random_uuid(),
  indicator_id uuid not null references public.indicator_definitions(id) on delete cascade,
  year integer not null check (year between 2020 and 2200),
  quarter public.quarter_code not null,
  scheduled_date date not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  unique (indicator_id, year, quarter),
  check (opens_at <= closes_at)
);

create table public.indicator_results (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null unique references public.indicator_periods(id) on delete cascade,
  value numeric not null,
  comments text,
  evidence_file_id uuid references public.file_objects(id) on delete restrict,
  evaluation_status public.indicator_result_status not null,
  submitted_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index indicator_definitions_process_idx
  on public.indicator_definitions(process_id, active);
create index indicator_periods_calendar_idx
  on public.indicator_periods(year, quarter, scheduled_date);

create trigger indicator_definitions_set_updated_at
before update on public.indicator_definitions
for each row execute function public.set_updated_at();
create trigger indicator_evaluation_rules_set_updated_at
before update on public.indicator_evaluation_rules
for each row execute function public.set_updated_at();
create trigger indicator_results_set_updated_at
before update on public.indicator_results
for each row execute function public.set_updated_at();

create or replace function public.evaluate_indicator_value(
  requested_indicator_id uuid,
  measured_value numeric
)
returns public.indicator_result_status
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rule public.indicator_evaluation_rules%rowtype;
  tolerance numeric;
begin
  select * into rule from public.indicator_evaluation_rules
  where indicator_id = requested_indicator_id;
  if not found then
    raise exception 'El indicador no tiene reglas de evaluación.';
  end if;

  tolerance := rule.marginal_tolerance_percent / 100.0;
  if rule.rule_type = 'minimum' then
    if measured_value >= rule.target_min then return 'compliant'; end if;
    if measured_value >= rule.target_min * (1 - tolerance) then return 'marginal'; end if;
  elsif rule.rule_type = 'maximum' then
    if measured_value <= rule.target_max then return 'compliant'; end if;
    if measured_value <= rule.target_max * (1 + tolerance) then return 'marginal'; end if;
  elsif rule.rule_type = 'range' then
    if measured_value between rule.target_min and rule.target_max then return 'compliant'; end if;
    if measured_value between rule.target_min * (1 - tolerance)
      and rule.target_max * (1 + tolerance) then return 'marginal'; end if;
  else
    if measured_value = rule.target_value then return 'compliant'; end if;
    if abs(measured_value - rule.target_value) <= greatest(abs(rule.target_value), 1) * tolerance
      then return 'marginal'; end if;
  end if;
  return 'noncompliant';
end;
$$;

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
  into selected_indicator_id, selected_process_id, selected_opens_at, selected_closes_at
  from public.indicator_periods p
  join public.indicator_definitions d on d.id = p.indicator_id
  where p.id = new.period_id;

  if selected_indicator_id is null then
    raise exception 'Periodo de indicador inválido.';
  end if;
  if auth.uid() is not null and not public.is_administrator() then
    if not public.has_process_access(selected_process_id) then
      raise exception 'El indicador no pertenece a un proceso asignado.';
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

create trigger indicator_results_guard
before insert or update on public.indicator_results
for each row execute function public.guard_indicator_result();

create table public.risk_registers (
  id uuid primary key default gen_random_uuid(),
  process_id text not null references public.processes(id) on delete restrict,
  year integer not null check (year between 2020 and 2200),
  owner_id uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'approved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (process_id, year)
);

create table public.risk_items (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references public.risk_registers(id) on delete cascade,
  code text not null unique,
  kind public.risk_kind not null,
  title text not null,
  description text not null,
  cause text,
  consequence text,
  likelihood smallint check (likelihood between 1 and 5),
  impact smallint check (impact between 1 and 5),
  residual_likelihood smallint check (residual_likelihood between 1 and 5),
  residual_impact smallint check (residual_impact between 1 and 5),
  treatment text,
  owner_id uuid references public.profiles(id) on delete set null,
  due_date date,
  status public.risk_status not null default 'identified',
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.risk_reviews (
  id uuid primary key default gen_random_uuid(),
  risk_id uuid not null references public.risk_items(id) on delete cascade,
  likelihood smallint not null check (likelihood between 1 and 5),
  impact smallint not null check (impact between 1 and 5),
  comment text,
  reviewed_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  reviewed_at timestamptz not null default now()
);

create trigger risk_registers_set_updated_at
before update on public.risk_registers
for each row execute function public.set_updated_at();
create trigger risk_items_set_updated_at
before update on public.risk_items
for each row execute function public.set_updated_at();

-- RLS: información documentada.
alter table public.document_types enable row level security;
alter table public.controlled_documents enable row level security;
alter table public.controlled_document_versions enable row level security;
alter table public.document_workflow_events enable row level security;

create policy document_types_internal_select on public.document_types
for select to authenticated using (public.is_internal_user());
create policy document_types_admin_write on public.document_types
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy controlled_documents_select_process on public.controlled_documents
for select to authenticated
using (public.has_module_permission('documents', 'view') and public.has_process_access(process_id));
create policy controlled_documents_insert_modifier on public.controlled_documents
for insert to authenticated
with check (
  created_by = auth.uid()
  and public.has_process_document_role(process_id, 'modifier')
);
create policy controlled_documents_update_modifier on public.controlled_documents
for update to authenticated
using (public.has_process_document_role(process_id, 'modifier'))
with check (public.has_process_document_role(process_id, 'modifier'));
create policy controlled_documents_delete_admin on public.controlled_documents
for delete to authenticated using (public.is_administrator());

create policy document_versions_select_scope on public.controlled_document_versions
for select to authenticated
using (
  public.is_administrator()
  or (
    exists (
      select 1
      from public.controlled_documents d
      where d.id = document_id
        and public.has_process_access(d.process_id)
        and (
          status = 'current'
          or (status in ('draft', 'rejected') and uploaded_by = auth.uid())
          or (
            status = 'pending'
            and (
              uploaded_by = auth.uid()
              or public.has_process_document_role(d.process_id, 'authorizer')
            )
          )
        )
    )
  )
);
create policy document_versions_insert_modifier on public.controlled_document_versions
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.controlled_documents d
    where d.id = document_id
      and public.has_process_document_role(d.process_id, 'modifier')
  )
);
create policy document_versions_update_scope on public.controlled_document_versions
for update to authenticated
using (
  public.is_administrator()
  or uploaded_by = auth.uid()
  or exists (
    select 1 from public.controlled_documents d
    where d.id = document_id
      and public.has_process_document_role(d.process_id, 'authorizer')
  )
);

create policy document_events_select_scope on public.document_workflow_events
for select to authenticated
using (
  public.is_administrator()
  or exists (
    select 1 from public.controlled_documents d
    where d.id = document_id and public.has_process_access(d.process_id)
  )
);

-- RLS: formularios y dashboards.
alter table public.form_definitions enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_records enable row level security;
alter table public.form_dashboard_definitions enable row level security;
alter table public.form_dashboard_insights enable row level security;
alter table public.form_import_jobs enable row level security;

create policy forms_select_process on public.form_definitions
for select to authenticated
using (public.has_module_permission('forms', 'view') and public.has_process_access(process_id));
create policy forms_manage on public.form_definitions
for all to authenticated
using (public.has_module_permission('forms', 'manage'))
with check (public.has_module_permission('forms', 'manage'));

create policy form_fields_select_scope on public.form_fields
for select to authenticated
using (exists (
  select 1 from public.form_definitions f
  where f.id = form_id and public.has_process_access(f.process_id)
));
create policy form_fields_manage on public.form_fields
for all to authenticated
using (public.has_module_permission('forms', 'manage'))
with check (public.has_module_permission('forms', 'manage'));

create policy form_records_select_process on public.form_records
for select to authenticated
using (exists (
  select 1 from public.form_definitions f
  where f.id = form_id and public.has_process_access(f.process_id)
));
create policy form_records_insert_process on public.form_records
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.form_definitions f
    where f.id = form_id and f.status = 'active'
      and public.has_process_access(f.process_id)
  )
);
create policy form_records_update_owner on public.form_records
for update to authenticated
using (
  public.is_administrator()
  or public.has_module_permission('forms', 'manage')
  or (created_by = auth.uid() and submitted_at is null)
)
with check (
  public.is_administrator()
  or public.has_module_permission('forms', 'manage')
  or created_by = auth.uid()
);

create policy dashboards_select_scope on public.form_dashboard_definitions
for select to authenticated
using (exists (
  select 1 from public.form_definitions f
  where f.id = form_id and public.has_process_access(f.process_id)
));
create policy dashboards_manage on public.form_dashboard_definitions
for all to authenticated
using (public.has_module_permission('forms', 'manage'))
with check (public.has_module_permission('forms', 'manage'));

create policy dashboard_insights_select_scope on public.form_dashboard_insights
for select to authenticated
using (exists (
  select 1
  from public.form_dashboard_definitions d
  join public.form_definitions f on f.id = d.form_id
  where d.id = dashboard_id and public.has_process_access(f.process_id)
));
create policy dashboard_insights_manage on public.form_dashboard_insights
for all to authenticated
using (public.has_module_permission('forms', 'manage'))
with check (public.has_module_permission('forms', 'manage'));

create policy form_import_jobs_select_scope on public.form_import_jobs
for select to authenticated
using (requested_by = auth.uid() or public.has_module_permission('forms', 'manage'));
create policy form_import_jobs_create on public.form_import_jobs
for insert to authenticated with check (requested_by = auth.uid());
create policy form_import_jobs_manage on public.form_import_jobs
for update to authenticated
using (requested_by = auth.uid() or public.has_module_permission('forms', 'manage'))
with check (requested_by = auth.uid() or public.has_module_permission('forms', 'manage'));

-- RLS: indicadores. Sólo administrador administra definiciones y reglas.
alter table public.indicator_definitions enable row level security;
alter table public.indicator_evaluation_rules enable row level security;
alter table public.indicator_periods enable row level security;
alter table public.indicator_results enable row level security;

create policy indicators_select_process on public.indicator_definitions
for select to authenticated
using (public.has_module_permission('indicators', 'view') and public.has_process_access(process_id));
create policy indicators_admin_write on public.indicator_definitions
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy indicator_rules_select_process on public.indicator_evaluation_rules
for select to authenticated
using (exists (
  select 1 from public.indicator_definitions i
  where i.id = indicator_id and public.has_process_access(i.process_id)
));
create policy indicator_rules_admin_write on public.indicator_evaluation_rules
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy indicator_periods_select_process on public.indicator_periods
for select to authenticated
using (exists (
  select 1 from public.indicator_definitions i
  where i.id = indicator_id and public.has_process_access(i.process_id)
));
create policy indicator_periods_admin_write on public.indicator_periods
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy indicator_results_select_process on public.indicator_results
for select to authenticated
using (exists (
  select 1
  from public.indicator_periods p
  join public.indicator_definitions i on i.id = p.indicator_id
  where p.id = period_id and public.has_process_access(i.process_id)
));
create policy indicator_results_insert_window on public.indicator_results
for insert to authenticated
with check (
  submitted_by = auth.uid()
  and exists (
    select 1
    from public.indicator_periods p
    join public.indicator_definitions i on i.id = p.indicator_id
    where p.id = period_id
      and public.has_process_access(i.process_id)
      and (public.is_administrator() or now() between p.opens_at and p.closes_at)
  )
);
create policy indicator_results_update_window on public.indicator_results
for update to authenticated
using (exists (
  select 1
  from public.indicator_periods p
  join public.indicator_definitions i on i.id = p.indicator_id
  where p.id = period_id
    and public.has_process_access(i.process_id)
    and (public.is_administrator() or now() between p.opens_at and p.closes_at)
))
with check (submitted_by = auth.uid() or public.is_administrator());

-- RLS: riesgos y oportunidades por proceso.
alter table public.risk_registers enable row level security;
alter table public.risk_items enable row level security;
alter table public.risk_reviews enable row level security;

create policy risk_registers_select_process on public.risk_registers
for select to authenticated
using (public.has_module_permission('risks', 'view') and public.has_process_access(process_id));
create policy risk_registers_write_process on public.risk_registers
for all to authenticated
using (public.has_process_document_role(process_id, 'modifier'))
with check (public.has_process_document_role(process_id, 'modifier'));

create policy risk_items_select_process on public.risk_items
for select to authenticated
using (exists (
  select 1 from public.risk_registers r
  where r.id = register_id and public.has_process_access(r.process_id)
));
create policy risk_items_write_process on public.risk_items
for all to authenticated
using (exists (
  select 1 from public.risk_registers r
  where r.id = register_id and public.has_process_document_role(r.process_id, 'modifier')
))
with check (exists (
  select 1 from public.risk_registers r
  where r.id = register_id and public.has_process_document_role(r.process_id, 'modifier')
));

create policy risk_reviews_select_process on public.risk_reviews
for select to authenticated
using (exists (
  select 1
  from public.risk_items i
  join public.risk_registers r on r.id = i.register_id
  where i.id = risk_id and public.has_process_access(r.process_id)
));
create policy risk_reviews_insert_process on public.risk_reviews
for insert to authenticated
with check (
  reviewed_by = auth.uid()
  and exists (
    select 1
    from public.risk_items i
    join public.risk_registers r on r.id = i.register_id
    where i.id = risk_id and public.has_process_access(r.process_id)
  )
);

create view public.controlled_document_register
with (security_invoker = true)
as
select
  d.id,
  d.process_id,
  d.document_type_id,
  d.code,
  d.title,
  v.id as version_id,
  v.revision,
  v.status,
  v.file_name,
  uploader.full_name as uploaded_by,
  validator.full_name as validated_by,
  v.updated_at as modified_at,
  v.authorized_at,
  v.rejection_reason
from public.controlled_documents d
left join lateral (
  select selected_version.*
  from public.controlled_document_versions selected_version
  where selected_version.document_id = d.id
  order by
    case selected_version.status when 'current' then 0 when 'pending' then 1 else 2 end,
    selected_version.revision desc
  limit 1
) v on true
left join public.profiles uploader on uploader.id = v.uploaded_by
left join public.profiles validator on validator.id = v.validator_id;

create view public.indicator_quarter_matrix
with (security_invoker = true)
as
select
  i.id as indicator_id,
  i.code,
  i.process_id,
  i.area,
  i.name,
  p.year,
  p.quarter,
  p.scheduled_date,
  p.opens_at,
  p.closes_at,
  r.value,
  r.comments,
  r.evidence_file_id,
  coalesce(
    r.evaluation_status::text,
    case when now() > p.closes_at then 'not_uploaded' else 'pending' end
  ) as display_status,
  r.submitted_by,
  r.submitted_at
from public.indicator_definitions i
join public.indicator_periods p on p.indicator_id = i.id
left join public.indicator_results r on r.period_id = p.id;

grant select, insert, update, delete on public.document_types to authenticated;
grant select, insert, update, delete on public.controlled_documents to authenticated;
grant select, insert on public.controlled_document_versions to authenticated;
grant select on public.document_workflow_events to authenticated;
grant execute on function public.submit_document_version(uuid) to authenticated;
grant execute on function public.review_document_version(uuid, text, text) to authenticated;

grant select, insert, update, delete on public.form_definitions to authenticated;
grant select, insert, update, delete on public.form_fields to authenticated;
grant select, insert, update on public.form_records to authenticated;
grant select, insert, update, delete on public.form_dashboard_definitions to authenticated;
grant select, insert, update, delete on public.form_dashboard_insights to authenticated;
grant select, insert, update on public.form_import_jobs to authenticated;

grant select, insert, update, delete on public.indicator_definitions to authenticated;
grant select, insert, update, delete on public.indicator_evaluation_rules to authenticated;
grant select, insert, update, delete on public.indicator_periods to authenticated;
grant select, insert, update on public.indicator_results to authenticated;
grant select on public.controlled_document_register to authenticated;
grant select on public.indicator_quarter_matrix to authenticated;

grant select, insert, update, delete on public.risk_registers to authenticated;
grant select, insert, update, delete on public.risk_items to authenticated;
grant select, insert on public.risk_reviews to authenticated;

insert into public.document_types (id, name, description, sort_order) values
  ('process', 'Proceso', 'Ficha y caracterización del proceso.', 1),
  ('manual', 'Manual', 'Manual del sistema o del proceso.', 2),
  ('procedure', 'Procedimiento', 'Secuencia documentada de actividades.', 3),
  ('instruction', 'Instructivo', 'Instrucción detallada de trabajo.', 4),
  ('format', 'Formato', 'Plantilla controlada sin captura dentro de IntegraQ.', 5),
  ('form', 'Formulario', 'Captura digital con historial y dashboard propio.', 6),
  ('standard-operation-sheet', 'Hoja de Operación Estándar', 'Estándar visual y operativo.', 7),
  ('visual-aid', 'Ayuda visual', 'Referencia visual controlada.', 8);

comment on table public.controlled_document_versions is
  'La interfaz muestra revisión, fecha de modificación, responsable y validador dentro de cada tipo documental.';
comment on table public.form_records is
  'Datos dinámicos del formulario; la estructura vive en form_fields y no se mezcla con Formatos.';
comment on table public.indicator_periods is
  'La ventana opens_at/closes_at controla cuándo puede capturarse cada trimestre.';
