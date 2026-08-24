-- IntegraQ: metrología, mejora continua, revisión por la dirección, IA y avisos.
-- Requiere las migraciones 001 a 004.

create type public.measurement_activity as enum ('calibration', 'verification');
create type public.measurement_event_status as enum (
  'scheduled', 'in_progress', 'completed', 'cancelled'
);
create type public.measurement_result as enum (
  'accepted', 'conditional', 'rejected'
);
create type public.improvement_project_type as enum ('kaizen', 'dmaic');
create type public.improvement_project_category as enum (
  'kpi', 'process', 'sgc', 'culture'
);
create type public.improvement_project_status as enum (
  'open', 'kickoff', 'in_progress', 'late', 'completed'
);
create type public.improvement_item_status as enum (
  'pending', 'active', 'completed'
);
create type public.management_review_status as enum (
  'draft', 'sgc_approved', 'operations_approved'
);
create type public.management_review_stage as enum ('sgc', 'operations');
create type public.approval_status as enum ('pending', 'approved', 'rejected');
create type public.ai_run_status as enum (
  'queued', 'processing', 'completed', 'failed', 'accepted', 'discarded'
);
create type public.notification_status as enum ('unread', 'read', 'dismissed');

create table public.measurement_assets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  process_id text references public.processes(id) on delete restrict,
  location text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  owner_name text,
  activity public.measurement_activity not null,
  frequency_months integer check (frequency_months is null or frequency_months > 0),
  frequency_days integer check (frequency_days is null or frequency_days > 0),
  last_completed_at date,
  next_due_date date,
  schedule_pending boolean not null default false,
  standard_description text,
  is_reference_standard boolean not null default false,
  external_provider text,
  measurement_category text,
  measurement_type text,
  brand text,
  model text,
  serial_number text,
  measurement_range text,
  resolution text,
  calibration_report text,
  observations text,
  source_document text,
  source_row integer,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint measurement_schedule check (
    frequency_months is not null or frequency_days is not null or schedule_pending
  )
);

create table public.measurement_asset_standards (
  asset_id uuid not null references public.measurement_assets(id) on delete cascade,
  standard_asset_id uuid not null references public.measurement_assets(id) on delete restrict,
  primary key (asset_id, standard_asset_id),
  check (asset_id <> standard_asset_id)
);

create table public.measurement_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.measurement_assets(id) on delete cascade,
  activity public.measurement_activity not null,
  scheduled_date date not null,
  completed_date date,
  status public.measurement_event_status not null default 'scheduled',
  result public.measurement_result,
  performed_by_id uuid references public.profiles(id) on delete set null,
  external_provider text,
  certificate_file_id uuid references public.file_objects(id) on delete restrict,
  evidence_file_id uuid references public.file_objects(id) on delete restrict,
  readings jsonb not null default '[]'::jsonb,
  comments text,
  next_due_date date,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index measurement_assets_due_idx
  on public.measurement_assets(active, next_due_date);
create index measurement_events_asset_idx
  on public.measurement_events(asset_id, scheduled_date desc);

create trigger measurement_assets_set_updated_at
before update on public.measurement_assets
for each row execute function public.set_updated_at();
create trigger measurement_events_set_updated_at
before update on public.measurement_events
for each row execute function public.set_updated_at();

create or replace function public.guard_measurement_standard_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.measurement_assets
    where id = new.standard_asset_id and is_reference_standard and active
  ) then
    raise exception 'El equipo asignado no es un patrón activo.';
  end if;
  return new;
end;
$$;

create trigger measurement_standard_link_guard
before insert or update on public.measurement_asset_standards
for each row execute function public.guard_measurement_standard_link();

create or replace function public.prepare_measurement_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_asset public.measurement_assets%rowtype;
begin
  select * into selected_asset
  from public.measurement_assets where id = new.asset_id;
  if selected_asset.id is null then
    raise exception 'Equipo de medición inexistente.';
  end if;
  if new.activity <> selected_asset.activity then
    raise exception 'La actividad no coincide con el alcance del equipo.';
  end if;

  if new.status = 'completed' then
    if new.completed_date is null or new.result is null then
      raise exception 'La fecha y el resultado son obligatorios para completar el evento.';
    end if;
    if selected_asset.frequency_days is null
      and selected_asset.frequency_months is null then
      raise exception 'Debe definirse una frecuencia antes de completar el evento.';
    end if;
    if new.activity = 'verification' and not exists (
      select 1
      from public.measurement_asset_standards link
      join public.measurement_assets standard on standard.id = link.standard_asset_id
      where link.asset_id = new.asset_id
        and standard.active
        and standard.is_reference_standard
        and not standard.schedule_pending
        and standard.next_due_date >= new.completed_date
    ) then
      raise exception 'No existe un patrón vigente para realizar la verificación interna.';
    end if;

    new.next_due_date := case
      when selected_asset.frequency_days is not null
        then new.completed_date + selected_asset.frequency_days
      else (
        new.completed_date
        + make_interval(months => selected_asset.frequency_months)
      )::date
    end;
  end if;
  return new;
end;
$$;

create or replace function public.sync_measurement_asset_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    update public.measurement_assets
    set last_completed_at = new.completed_date,
        next_due_date = new.next_due_date,
        schedule_pending = false
    where id = new.asset_id;
  end if;
  return new;
end;
$$;

create trigger measurement_event_prepare
before insert or update on public.measurement_events
for each row execute function public.prepare_measurement_event();
create trigger measurement_event_sync_schedule
after insert or update of status, completed_date on public.measurement_events
for each row execute function public.sync_measurement_asset_schedule();

create table public.improvement_projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  project_type public.improvement_project_type not null,
  category public.improvement_project_category not null,
  intake_source text not null default 'direct' check (intake_source in ('idea', 'direct')),
  status public.improvement_project_status not null default 'open',
  process_id text not null references public.processes(id) on delete restrict,
  submitted_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  sponsor_id uuid references public.profiles(id) on delete set null,
  sponsor_name text,
  leader_id uuid references public.profiles(id) on delete set null,
  leader_name text,
  improvement_owner_id uuid references public.profiles(id) on delete set null,
  improvement_owner_name text,
  problem text not null,
  objective text not null,
  scope text not null,
  customer text,
  metric text,
  baseline text,
  target text,
  start_date date not null,
  target_date date not null,
  estimated_investment numeric not null default 0,
  estimated_savings numeric not null default 0,
  realized_benefit numeric not null default 0,
  total_score numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date <= target_date)
);

create table public.improvement_project_members (
  project_id uuid not null references public.improvement_projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  project_role text not null default 'member'
    check (project_role in ('sponsor', 'leader', 'owner', 'member')),
  primary key (project_id, profile_id, project_role)
);

create table public.improvement_score_criteria (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.improvement_projects(id) on delete cascade,
  criterion_key text not null,
  label text not null,
  description text,
  weight numeric not null check (weight >= 0),
  rating numeric not null check (rating >= 0),
  max_rating numeric not null check (max_rating > 0),
  options jsonb not null default '[]'::jsonb,
  unique (project_id, criterion_key)
);

create table public.improvement_phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.improvement_projects(id) on delete cascade,
  phase_key text not null,
  name text not null,
  target_date date not null,
  status public.improvement_item_status not null default 'pending',
  sort_order integer not null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  unique (project_id, phase_key)
);

create table public.improvement_tools (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.improvement_phases(id) on delete cascade,
  tool_key text not null,
  name text not null,
  description text,
  status public.improvement_item_status not null default 'pending',
  result_data jsonb not null default '{}'::jsonb,
  evidence_file_id uuid references public.file_objects(id) on delete restrict,
  sort_order integer not null,
  unique (phase_id, tool_key)
);

create table public.improvement_actions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.improvement_projects(id) on delete cascade,
  phase_id uuid references public.improvement_phases(id) on delete set null,
  description text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  owner_name text,
  due_date date not null,
  status public.action_item_status not null default 'pending',
  evidence_file_id uuid references public.file_objects(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.kaizen_reports (
  project_id uuid primary key references public.improvement_projects(id) on delete cascade,
  improvement_kind text not null
    check (improvement_kind in ('documental', 'device', 'tooling', 'process', 'area')),
  before_description text not null,
  improvement_description text not null,
  before_file_id uuid references public.file_objects(id) on delete restrict,
  improvement_file_id uuid references public.file_objects(id) on delete restrict,
  released_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  released_at timestamptz,
  check (
    project_id is not null
  )
);

create index improvement_projects_process_status_idx
  on public.improvement_projects(process_id, status, target_date);

create trigger improvement_projects_set_updated_at
before update on public.improvement_projects
for each row execute function public.set_updated_at();
create trigger improvement_actions_set_updated_at
before update on public.improvement_actions
for each row execute function public.set_updated_at();

create or replace function public.can_access_improvement_project(
  requested_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.improvement_projects p
    where p.id = requested_project_id
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('continuous-improvement', 'view')
          and (
            public.has_process_access(p.process_id)
            or p.submitted_by = auth.uid()
            or p.sponsor_id = auth.uid()
            or p.leader_id = auth.uid()
            or p.improvement_owner_id = auth.uid()
            or exists (
              select 1 from public.improvement_project_members m
              where m.project_id = p.id and m.profile_id = auth.uid()
            )
          )
        )
      )
  );
$$;

create table public.management_reviews (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2020 and 2200),
  period_label text not null,
  period_start date not null,
  period_end date not null,
  revision integer not null default 0 check (revision >= 0),
  status public.management_review_status not null default 'draft',
  generated_once boolean not null default true check (generated_once),
  generated_at timestamptz not null default now(),
  generated_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  context_fingerprint text not null,
  executive_summary text not null,
  ai_mode text not null default 'demo' check (ai_mode in ('external', 'demo')),
  warnings jsonb not null default '[]'::jsonb,
  report_file_id uuid references public.file_objects(id) on delete set null,
  modified_at timestamptz not null default now(),
  unique (period_start, period_end),
  check (period_start <= period_end)
);

create table public.management_review_sources (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.management_reviews(id) on delete cascade,
  source_key text not null,
  label text not null,
  status text not null check (status in ('connected', 'pending')),
  record_count integer not null default 0 check (record_count >= 0),
  summary text not null,
  metrics jsonb not null default '[]'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  unique (review_id, source_key)
);

create table public.management_review_sections (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.management_reviews(id) on delete cascade,
  section_key text not null,
  title text not null,
  content text not null,
  source_keys jsonb not null default '[]'::jsonb,
  sort_order integer not null,
  unique (review_id, section_key)
);

create table public.management_review_decisions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.management_reviews(id) on delete cascade,
  description text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  owner_name text,
  due_date date not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  status public.action_item_status not null default 'pending',
  evidence_file_id uuid references public.file_objects(id) on delete restrict,
  completed_at timestamptz
);

create table public.management_review_approvals (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.management_reviews(id) on delete cascade,
  stage public.management_review_stage not null,
  status public.approval_status not null default 'pending',
  required_position_id text references public.positions(id) on delete set null,
  assigned_approver_id uuid references public.profiles(id) on delete set null,
  approver_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  comment text,
  unique (review_id, stage)
);

create or replace function public.decide_management_review(
  requested_review_id uuid,
  requested_stage public.management_review_stage,
  decision public.approval_status,
  decision_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval_record public.management_review_approvals%rowtype;
  current_review_status public.management_review_status;
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'Decisión inválida.';
  end if;

  select * into approval_record
  from public.management_review_approvals
  where review_id = requested_review_id and stage = requested_stage
  for update;
  select status into current_review_status
  from public.management_reviews where id = requested_review_id for update;

  if approval_record.id is null then
    raise exception 'Etapa de autorización inexistente.';
  end if;
  if not public.is_administrator()
    and approval_record.assigned_approver_id is distinct from auth.uid() then
    raise exception 'La revisión no está asignada a este usuario.';
  end if;
  if requested_stage = 'operations' and current_review_status <> 'sgc_approved' then
    raise exception 'Primero debe aprobar el responsable del SGC.';
  end if;
  if decision = 'rejected' and nullif(trim(decision_comment), '') is null then
    raise exception 'El motivo de rechazo es obligatorio.';
  end if;

  update public.management_review_approvals
  set status = decision, approver_id = auth.uid(), approved_at = now(),
      comment = decision_comment
  where id = approval_record.id;

  update public.management_reviews
  set status = case
        when decision = 'rejected' then 'draft'::public.management_review_status
        when requested_stage = 'sgc' then 'sgc_approved'::public.management_review_status
        else 'operations_approved'::public.management_review_status
      end,
      modified_at = now()
  where id = requested_review_id;

  return requested_review_id;
end;
$$;

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  task_type text not null check (
    task_type in ('root_cause', 'form_import', 'dashboard_design', 'management_review', 'metrology_check', 'smart_search')
  ),
  module_id text references public.workspace_modules(id) on delete set null,
  resource_type text,
  resource_id uuid,
  input_fingerprint text,
  request_context jsonb not null default '{}'::jsonb,
  response_data jsonb,
  provider text,
  model text,
  status public.ai_run_status not null default 'queued',
  error_message text,
  requested_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  module_id text references public.workspace_modules(id) on delete set null,
  resource_type text,
  resource_id uuid,
  status public.notification_status not null default 'unread',
  action_url text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  resource_type text not null,
  resource_id uuid,
  recipient_email text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index notifications_recipient_idx
  on public.notifications(recipient_id, status, created_at desc);
create index ai_runs_requester_idx on public.ai_runs(requested_by, created_at desc);
create index integration_outbox_pending_idx
  on public.integration_outbox(status, available_at)
  where status in ('pending', 'failed');

create or replace function public.notify_supplier_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_folio text;
begin
  if new.status <> 'submitted' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select folio into report_folio
  from public.supplier_rncp_reports where id = new.report_id;

  insert into public.notifications (
    recipient_id, title, message, module_id, resource_type, resource_id, action_url
  )
  select distinct p.id,
    'Respuesta de proveedor recibida',
    'El proveedor actualizó acciones o evidencias del RNCP ' || report_folio || '.',
    'suppliers', 'supplier_rncp_report', new.report_id,
    '/#suppliers'
  from public.profiles p
  join public.user_module_permissions m on m.user_id = p.id
  where p.status = 'active' and m.module_id = 'suppliers' and m.can_view;

  insert into public.integration_outbox (
    event_type, resource_type, resource_id, payload
  ) values (
    'supplier_response_submitted', 'supplier_rncp_report', new.report_id,
    jsonb_build_object('folio', report_folio, 'action_id', new.id)
  );
  return new;
end;
$$;

create trigger supplier_response_notify
after insert or update of status on public.supplier_rncp_actions
for each row execute function public.notify_supplier_response();

-- RLS: metrología.
alter table public.measurement_assets enable row level security;
alter table public.measurement_asset_standards enable row level security;
alter table public.measurement_events enable row level security;

create policy measurement_assets_select_scope on public.measurement_assets
for select to authenticated
using (
  public.has_module_permission('calibrations', 'view')
  and (process_id is null or public.has_process_access(process_id))
);
create policy measurement_assets_manage on public.measurement_assets
for all to authenticated
using (public.has_module_permission('calibrations', 'manage'))
with check (public.has_module_permission('calibrations', 'manage'));

create policy measurement_standards_select_scope on public.measurement_asset_standards
for select to authenticated
using (exists (
  select 1 from public.measurement_assets a
  where a.id = asset_id and public.has_module_permission('calibrations', 'view')
));
create policy measurement_standards_manage on public.measurement_asset_standards
for all to authenticated
using (public.has_module_permission('calibrations', 'manage'))
with check (public.has_module_permission('calibrations', 'manage'));

create policy measurement_events_select_scope on public.measurement_events
for select to authenticated
using (exists (
  select 1 from public.measurement_assets a
  where a.id = asset_id and public.has_module_permission('calibrations', 'view')
    and (a.process_id is null or public.has_process_access(a.process_id))
));
create policy measurement_events_write_scope on public.measurement_events
for all to authenticated
using (public.has_module_permission('calibrations', 'update'))
with check (public.has_module_permission('calibrations', 'update'));

-- RLS: mejora continua.
alter table public.improvement_projects enable row level security;
alter table public.improvement_project_members enable row level security;
alter table public.improvement_score_criteria enable row level security;
alter table public.improvement_phases enable row level security;
alter table public.improvement_tools enable row level security;
alter table public.improvement_actions enable row level security;
alter table public.kaizen_reports enable row level security;

create policy improvement_projects_select_scope on public.improvement_projects
for select to authenticated using (public.can_access_improvement_project(id));
create policy improvement_projects_create on public.improvement_projects
for insert to authenticated
with check (
  submitted_by = auth.uid()
  and public.is_internal_user()
  and public.has_process_access(process_id)
);
create policy improvement_projects_manage on public.improvement_projects
for update to authenticated
using (
  public.is_administrator()
  or exists (
    select 1 from public.profiles
    where id = auth.uid() and continuous_improvement_role = 'manager'
  )
  or submitted_by = auth.uid()
)
with check (public.can_access_improvement_project(id));

create policy improvement_members_select_scope on public.improvement_project_members
for select to authenticated using (public.can_access_improvement_project(project_id));
create policy improvement_members_manage on public.improvement_project_members
for all to authenticated
using (public.has_module_permission('continuous-improvement', 'manage'))
with check (public.has_module_permission('continuous-improvement', 'manage'));

create policy improvement_scores_select_scope on public.improvement_score_criteria
for select to authenticated using (public.can_access_improvement_project(project_id));
create policy improvement_scores_manage on public.improvement_score_criteria
for all to authenticated
using (public.has_module_permission('continuous-improvement', 'manage'))
with check (public.has_module_permission('continuous-improvement', 'manage'));

create policy improvement_phases_select_scope on public.improvement_phases
for select to authenticated using (public.can_access_improvement_project(project_id));
create policy improvement_phases_manage on public.improvement_phases
for all to authenticated
using (public.has_module_permission('continuous-improvement', 'manage'))
with check (public.has_module_permission('continuous-improvement', 'manage'));

create policy improvement_tools_select_scope on public.improvement_tools
for select to authenticated
using (exists (
  select 1 from public.improvement_phases p
  where p.id = phase_id and public.can_access_improvement_project(p.project_id)
));
create policy improvement_tools_write_scope on public.improvement_tools
for all to authenticated
using (exists (
  select 1 from public.improvement_phases p
  where p.id = phase_id and public.can_access_improvement_project(p.project_id)
))
with check (exists (
  select 1 from public.improvement_phases p
  where p.id = phase_id and public.can_access_improvement_project(p.project_id)
));

create policy improvement_actions_select_scope on public.improvement_actions
for select to authenticated using (public.can_access_improvement_project(project_id));
create policy improvement_actions_write_scope on public.improvement_actions
for all to authenticated
using (public.can_access_improvement_project(project_id))
with check (public.can_access_improvement_project(project_id));

create policy kaizen_reports_select_scope on public.kaizen_reports
for select to authenticated using (public.can_access_improvement_project(project_id));
create policy kaizen_reports_write_scope on public.kaizen_reports
for all to authenticated
using (public.can_access_improvement_project(project_id))
with check (public.can_access_improvement_project(project_id));

-- RLS: revisión por la dirección, IA y notificaciones.
alter table public.management_reviews enable row level security;
alter table public.management_review_sources enable row level security;
alter table public.management_review_sections enable row level security;
alter table public.management_review_decisions enable row level security;
alter table public.management_review_approvals enable row level security;
alter table public.ai_runs enable row level security;
alter table public.notifications enable row level security;
alter table public.integration_outbox enable row level security;

create policy management_reviews_select_scope on public.management_reviews
for select to authenticated
using (public.has_module_permission('management-review', 'view'));
create policy management_reviews_admin_create on public.management_reviews
for insert to authenticated with check (public.is_administrator());
create policy management_reviews_admin_update on public.management_reviews
for update to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy management_sources_select_scope on public.management_review_sources
for select to authenticated
using (exists (
  select 1 from public.management_reviews r
  where r.id = review_id and public.has_module_permission('management-review', 'view')
));
create policy management_sources_admin_write on public.management_review_sources
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy management_sections_select_scope on public.management_review_sections
for select to authenticated
using (exists (
  select 1 from public.management_reviews r
  where r.id = review_id and public.has_module_permission('management-review', 'view')
));
create policy management_sections_admin_write on public.management_review_sections
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy management_decisions_select_scope on public.management_review_decisions
for select to authenticated
using (exists (
  select 1 from public.management_reviews r
  where r.id = review_id and public.has_module_permission('management-review', 'view')
));
create policy management_decisions_write_scope on public.management_review_decisions
for all to authenticated
using (public.has_module_permission('management-review', 'update'))
with check (public.has_module_permission('management-review', 'update'));

create policy management_approvals_select_scope on public.management_review_approvals
for select to authenticated
using (
  public.has_module_permission('management-review', 'view')
  or assigned_approver_id = auth.uid()
);
create policy management_approvals_admin_write on public.management_review_approvals
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy ai_runs_select_scope on public.ai_runs
for select to authenticated
using (requested_by = auth.uid() or public.is_administrator());
create policy ai_runs_create on public.ai_runs
for insert to authenticated with check (requested_by = auth.uid());
create policy ai_runs_update_scope on public.ai_runs
for update to authenticated
using (requested_by = auth.uid() or public.is_administrator())
with check (requested_by = auth.uid() or public.is_administrator());

create policy notifications_select_own on public.notifications
for select to authenticated using (recipient_id = auth.uid() or public.is_administrator());
create policy notifications_update_own on public.notifications
for update to authenticated
using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create policy integration_outbox_admin_only on public.integration_outbox
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

grant select, insert, update, delete on public.measurement_assets to authenticated;
grant select, insert, update, delete on public.measurement_asset_standards to authenticated;
grant select, insert, update, delete on public.measurement_events to authenticated;
grant select, insert, update, delete on public.improvement_projects to authenticated;
grant select, insert, update, delete on public.improvement_project_members to authenticated;
grant select, insert, update, delete on public.improvement_score_criteria to authenticated;
grant select, insert, update, delete on public.improvement_phases to authenticated;
grant select, insert, update, delete on public.improvement_tools to authenticated;
grant select, insert, update, delete on public.improvement_actions to authenticated;
grant select, insert, update, delete on public.kaizen_reports to authenticated;
grant select, insert, update on public.management_reviews to authenticated;
grant select, insert, update, delete on public.management_review_sources to authenticated;
grant select, insert, update, delete on public.management_review_sections to authenticated;
grant select, insert, update, delete on public.management_review_decisions to authenticated;
grant select, insert, update, delete on public.management_review_approvals to authenticated;
grant execute on function public.decide_management_review(
  uuid, public.management_review_stage, public.approval_status, text
) to authenticated;
grant select, insert, update on public.ai_runs to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert, update, delete on public.integration_outbox to authenticated;

comment on table public.management_reviews is
  'Cada periodo se genera una sola vez; conserva fuentes, secciones, decisiones, PDF y autorizaciones.';
comment on table public.ai_runs is
  'Toda salida de IA es borrador trazable y requiere aceptación humana.';
comment on table public.integration_outbox is
  'Cola transaccional para correo, webhooks y avisos; no expone credenciales de integración.';
