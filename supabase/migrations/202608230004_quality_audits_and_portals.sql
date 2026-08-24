-- IntegraQ: auditorías, Root2Cause, clientes, proveedores y portales.
-- Requiere las migraciones 001 a 003.

create type public.audit_type as enum (
  'internal', 'external', 'supplier', 'customer', 'certification'
);
create type public.audit_status as enum (
  'scheduled', 'in_progress', 'completed', 'cancelled'
);
create type public.finding_severity as enum (
  'observation', 'minor', 'major', 'critical'
);
create type public.quality_case_kind as enum ('claim', 'finding');
create type public.quality_case_status as enum (
  'open', 'under_review', 'action_required', 'closed'
);
create type public.corrective_action_source as enum (
  'internal', 'audit', 'customer', 'supplier', 'sgc'
);
create type public.corrective_action_severity as enum (
  'low', 'medium', 'high', 'critical'
);
create type public.corrective_action_status as enum (
  'open', 'analysis', 'action_plan', 'implementation', 'effectiveness', 'closed'
);
create type public.action_item_status as enum (
  'pending', 'in_progress', 'completed', 'cancelled'
);
create type public.supplier_rncp_status as enum (
  'open', 'in_progress', 'late', 'closed'
);
create type public.supplier_response_status as enum (
  'pending', 'in_progress', 'submitted', 'accepted', 'rejected', 'closed'
);

create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  issuer text,
  scope text,
  valid_from date,
  valid_until date,
  certificate_file_id uuid references public.file_objects(id) on delete restrict,
  customer_visible boolean not null default false,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_from <= valid_until)
);

create table public.audit_programs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  audit_type public.audit_type not null,
  year integer not null check (year between 2020 and 2200),
  semester smallint check (semester in (1, 2)),
  status text not null default 'draft' check (status in ('draft', 'approved', 'closed')),
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  version integer not null check (version > 0),
  audit_type public.audit_type not null,
  source_file_id uuid references public.file_objects(id) on delete set null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  unique (code, version)
);

create table public.audit_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.audit_templates(id) on delete cascade,
  section text not null,
  item_number text not null,
  requirement text not null,
  weight numeric not null default 1 check (weight >= 0),
  sort_order integer not null,
  unique (template_id, item_number)
);

create table public.audits (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references public.audit_programs(id) on delete set null,
  template_id uuid references public.audit_templates(id) on delete set null,
  code text not null unique,
  title text not null,
  audit_type public.audit_type not null,
  process_id text references public.processes(id) on delete restrict,
  external_organization_id uuid references public.organizations(id) on delete restrict,
  scope text,
  scheduled_date date not null,
  started_at timestamptz,
  completed_at timestamptz,
  status public.audit_status not null default 'scheduled',
  score numeric check (score is null or score between 0 and 100),
  result_summary text,
  checklist_source_file_id uuid references public.file_objects(id) on delete set null,
  result_file_id uuid references public.file_objects(id) on delete set null,
  portal_visible boolean not null default false,
  lead_auditor_id uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_audit_org check (
    audit_type not in ('supplier', 'customer') or external_organization_id is not null
  )
);

create table public.audit_participants (
  audit_id uuid not null references public.audits(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('lead', 'auditor', 'auditee', 'observer')),
  primary key (audit_id, profile_id, role)
);

create table public.audit_responses (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  template_item_id uuid references public.audit_template_items(id) on delete set null,
  result text not null check (result in ('conforming', 'nonconforming', 'not_applicable')),
  score numeric,
  comment text,
  evidence_file_id uuid references public.file_objects(id) on delete restrict,
  recorded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  recorded_at timestamptz not null default now()
);

create table public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  folio text not null unique,
  requirement text,
  description text not null,
  severity public.finding_severity not null,
  due_date date,
  status text not null default 'open'
    check (status in ('open', 'action_plan', 'verification', 'closed')),
  portal_visible boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_finding_actions (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.audit_findings(id) on delete cascade,
  description text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  owner_name text,
  due_date date not null,
  status public.supplier_response_status not null default 'pending',
  evidence_file_id uuid references public.file_objects(id) on delete restrict,
  submitted_at timestamptz,
  validated_by uuid references public.profiles(id) on delete set null,
  validated_at timestamptz,
  validation_comment text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index audits_calendar_idx on public.audits(scheduled_date, audit_type, status);
create index audits_external_org_idx on public.audits(external_organization_id);
create index audit_findings_audit_idx on public.audit_findings(audit_id, status);

create table public.quality_cases (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,
  kind public.quality_case_kind not null,
  external_organization_id uuid not null references public.organizations(id) on delete restrict,
  process_id text references public.processes(id) on delete restrict,
  title text not null,
  description text not null,
  received_at date not null,
  status public.quality_case_status not null default 'open',
  external_reference text,
  portal_visible boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.corrective_actions (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,
  title text not null,
  problem text not null,
  source public.corrective_action_source not null,
  severity public.corrective_action_severity not null,
  process_id text references public.processes(id) on delete restrict,
  area text,
  owner_id uuid references public.profiles(id) on delete set null,
  owner_name text,
  quality_case_id uuid unique references public.quality_cases(id) on delete set null,
  audit_finding_id uuid unique references public.audit_findings(id) on delete set null,
  external_organization_id uuid references public.organizations(id) on delete restrict,
  due_date date not null,
  status public.corrective_action_status not null default 'open',
  progress smallint not null default 0 check (progress between 0 and 100),
  root_cause text,
  portal_visible boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint customer_action_scope check (
    source <> 'customer' or external_organization_id is not null
  )
);

create table public.corrective_action_a3 (
  corrective_action_id uuid primary key references public.corrective_actions(id) on delete cascade,
  event_type text,
  severity_justification text,
  five_w_two_h jsonb not null default '{}'::jsonb,
  brainstorm jsonb not null default '[]'::jsonb,
  ishikawa jsonb not null default '{}'::jsonb,
  non_detection_cause text,
  non_detection_whys jsonb not null default '[]'::jsonb,
  root_cause text,
  root_cause_whys jsonb not null default '[]'::jsonb,
  ai_draft jsonb,
  ai_context_fingerprint text,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.corrective_action_plans (
  id uuid primary key default gen_random_uuid(),
  corrective_action_id uuid not null references public.corrective_actions(id) on delete cascade,
  description text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  owner_name text,
  due_date date not null,
  status public.action_item_status not null default 'pending',
  evidence_file_id uuid references public.file_objects(id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.corrective_action_effectiveness_reviews (
  id uuid primary key default gen_random_uuid(),
  corrective_action_id uuid not null references public.corrective_actions(id) on delete cascade,
  result text not null check (result in ('effective', 'partially_effective', 'ineffective')),
  review text not null,
  evidence_file_id uuid references public.file_objects(id) on delete restrict,
  reviewed_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  reviewed_at timestamptz not null default now()
);

create index corrective_actions_process_status_idx
  on public.corrective_actions(process_id, status, due_date);
create index corrective_actions_external_org_idx
  on public.corrective_actions(external_organization_id, source, portal_visible);

create table public.supplier_quality_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  category text,
  audit_required boolean not null default true,
  effectiveness numeric check (effectiveness is null or effectiveness between 0 and 100),
  current_quality_level numeric check (current_quality_level is null or current_quality_level between 0 and 100),
  exemption_reason text,
  active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.supplier_quality_evaluations (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.organizations(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  purchases_total numeric not null default 0 check (purchases_total >= 0),
  non_quality_total numeric not null default 0 check (non_quality_total >= 0),
  effectiveness numeric not null check (effectiveness between 0 and 100),
  quality_level numeric not null check (quality_level between 0 and 100),
  source_file_id uuid references public.file_objects(id) on delete set null,
  calculated_manually boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  unique (supplier_id, period_start, period_end),
  check (period_start <= period_end)
);

create table public.supplier_rncp_reports (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,
  supplier_id uuid not null references public.organizations(id) on delete restrict,
  report_date date not null,
  purchase_order text,
  material_or_service text,
  finding_type text,
  rejected_quantity numeric check (rejected_quantity is null or rejected_quantity >= 0),
  description text not null,
  immediate_disposition text,
  response_due_date date not null,
  status public.supplier_rncp_status not null default 'open',
  generated_pdf_file_id uuid references public.file_objects(id) on delete set null,
  portal_visible boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.supplier_rncp_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.supplier_rncp_reports(id) on delete cascade,
  description text not null,
  due_date date not null,
  status public.supplier_response_status not null default 'pending',
  supplier_comment text,
  evidence_file_id uuid references public.file_objects(id) on delete restrict,
  submitted_at timestamptz,
  validated_by uuid references public.profiles(id) on delete set null,
  validated_at timestamptz,
  validation_comment text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index supplier_rncp_supplier_status_idx
  on public.supplier_rncp_reports(supplier_id, status, response_due_date);
create index supplier_quality_eval_supplier_idx
  on public.supplier_quality_evaluations(supplier_id, period_end desc);

create trigger certifications_set_updated_at
before update on public.certifications
for each row execute function public.set_updated_at();
create trigger audit_programs_set_updated_at
before update on public.audit_programs
for each row execute function public.set_updated_at();
create trigger audits_set_updated_at
before update on public.audits
for each row execute function public.set_updated_at();
create trigger audit_findings_set_updated_at
before update on public.audit_findings
for each row execute function public.set_updated_at();
create trigger audit_finding_actions_set_updated_at
before update on public.audit_finding_actions
for each row execute function public.set_updated_at();
create trigger quality_cases_set_updated_at
before update on public.quality_cases
for each row execute function public.set_updated_at();
create trigger corrective_actions_set_updated_at
before update on public.corrective_actions
for each row execute function public.set_updated_at();
create trigger corrective_action_a3_set_updated_at
before update on public.corrective_action_a3
for each row execute function public.set_updated_at();
create trigger corrective_action_plans_set_updated_at
before update on public.corrective_action_plans
for each row execute function public.set_updated_at();
create trigger supplier_quality_profiles_set_updated_at
before update on public.supplier_quality_profiles
for each row execute function public.set_updated_at();
create trigger supplier_rncp_reports_set_updated_at
before update on public.supplier_rncp_reports
for each row execute function public.set_updated_at();
create trigger supplier_rncp_actions_set_updated_at
before update on public.supplier_rncp_actions
for each row execute function public.set_updated_at();

create or replace function public.can_access_audit(requested_audit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.audits a
    where a.id = requested_audit_id
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('audits', 'view')
          and (a.process_id is null or public.has_process_access(a.process_id))
        )
        or (
          public.current_user_type() = 'customer'
          and a.portal_visible
          and (
            a.audit_type = 'external'
            or public.has_external_organization_scope('customer', a.external_organization_id)
          )
        )
        or (
          public.current_user_type() = 'supplier'
          and a.portal_visible
          and a.audit_type = 'supplier'
          and public.has_external_organization_scope('supplier', a.external_organization_id)
        )
      )
  );
$$;

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
    select 1 from public.corrective_actions c
    where c.id = requested_action_id
      and (
        public.is_administrator()
        or (
          public.is_internal_user()
          and public.has_module_permission('corrective-actions', 'view')
          and (c.process_id is null or public.has_process_access(c.process_id))
        )
        or (
          c.source = 'customer'
          and c.portal_visible
          and public.has_external_organization_scope('customer', c.external_organization_id)
        )
      )
  );
$$;

create or replace function public.can_access_supplier_report(
  requested_report_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.supplier_rncp_reports r
    where r.id = requested_report_id
      and (
        public.is_administrator()
        or (public.is_internal_user() and public.has_module_permission('suppliers', 'view'))
        or (
          r.portal_visible
          and public.has_external_organization_scope('supplier', r.supplier_id)
        )
      )
  );
$$;

create or replace function public.guard_supplier_action_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_type() = 'supplier' then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    else
      if new.report_id <> old.report_id
        or new.due_date <> old.due_date
        or new.validated_by is distinct from old.validated_by
        or new.validated_at is distinct from old.validated_at
        or new.validation_comment is distinct from old.validation_comment then
        raise exception 'El proveedor no puede modificar control interno o fechas compromiso.';
      end if;
      new.created_by := old.created_by;
    end if;
    if new.status not in ('pending', 'in_progress', 'submitted') then
      raise exception 'Estado no permitido para el proveedor.';
    end if;
    if new.status = 'submitted' and new.submitted_at is null then
      new.submitted_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger supplier_action_guard
before insert or update on public.supplier_rncp_actions
for each row execute function public.guard_supplier_action_update();

-- RLS de auditorías y certificados.
alter table public.certifications enable row level security;
alter table public.audit_programs enable row level security;
alter table public.audit_templates enable row level security;
alter table public.audit_template_items enable row level security;
alter table public.audits enable row level security;
alter table public.audit_participants enable row level security;
alter table public.audit_responses enable row level security;
alter table public.audit_findings enable row level security;
alter table public.audit_finding_actions enable row level security;

create policy organizations_customer_quality_select
on public.organizations for select to authenticated
using (kind = 'customer' and public.has_module_permission('customers', 'view'));
create policy organizations_supplier_quality_select
on public.organizations for select to authenticated
using (kind = 'supplier' and public.has_module_permission('suppliers', 'view'));

create policy certifications_select_scope on public.certifications
for select to authenticated
using (
  public.is_internal_user()
  or (public.current_user_type() = 'customer' and customer_visible and active)
);
create policy certifications_admin_write on public.certifications
for all to authenticated
using (public.is_administrator()) with check (public.is_administrator());

create policy audit_programs_internal_select on public.audit_programs
for select to authenticated using (public.has_module_permission('audits', 'view'));
create policy audit_programs_manage on public.audit_programs
for all to authenticated
using (public.has_module_permission('audits', 'manage'))
with check (public.has_module_permission('audits', 'manage'));

create policy audit_templates_internal_select on public.audit_templates
for select to authenticated using (public.has_module_permission('audits', 'view'));
create policy audit_templates_manage on public.audit_templates
for all to authenticated
using (public.has_module_permission('audits', 'manage'))
with check (public.has_module_permission('audits', 'manage'));

create policy audit_template_items_internal_select on public.audit_template_items
for select to authenticated
using (exists (
  select 1 from public.audit_templates t
  where t.id = template_id and public.has_module_permission('audits', 'view')
));
create policy audit_template_items_manage on public.audit_template_items
for all to authenticated
using (public.has_module_permission('audits', 'manage'))
with check (public.has_module_permission('audits', 'manage'));

create policy audits_select_scope on public.audits
for select to authenticated using (public.can_access_audit(id));
create policy audits_internal_write on public.audits
for all to authenticated
using (public.is_internal_user() and public.has_module_permission('audits', 'update'))
with check (public.is_internal_user() and public.has_module_permission('audits', 'update'));

create policy audit_participants_select_scope on public.audit_participants
for select to authenticated using (public.can_access_audit(audit_id));
create policy audit_participants_manage on public.audit_participants
for all to authenticated
using (public.has_module_permission('audits', 'manage'))
with check (public.has_module_permission('audits', 'manage'));

create policy audit_responses_select_scope on public.audit_responses
for select to authenticated using (public.can_access_audit(audit_id));
create policy audit_responses_internal_write on public.audit_responses
for all to authenticated
using (public.is_internal_user() and public.can_access_audit(audit_id))
with check (public.is_internal_user() and public.can_access_audit(audit_id));

create policy audit_findings_select_scope on public.audit_findings
for select to authenticated
using (public.can_access_audit(audit_id) and (public.is_internal_user() or portal_visible));
create policy audit_findings_internal_write on public.audit_findings
for all to authenticated
using (public.is_internal_user() and public.can_access_audit(audit_id))
with check (public.is_internal_user() and public.can_access_audit(audit_id));

create policy audit_finding_actions_select_scope on public.audit_finding_actions
for select to authenticated
using (exists (
  select 1 from public.audit_findings f
  where f.id = finding_id and public.can_access_audit(f.audit_id)
));
create policy audit_finding_actions_internal_write on public.audit_finding_actions
for all to authenticated
using (public.is_internal_user()) with check (public.is_internal_user());
create policy audit_finding_actions_supplier_insert on public.audit_finding_actions
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.audit_findings f
    join public.audits a on a.id = f.audit_id
    where f.id = finding_id and f.portal_visible and a.portal_visible
      and public.has_external_organization_scope('supplier', a.external_organization_id)
  )
);
create policy audit_finding_actions_supplier_update on public.audit_finding_actions
for update to authenticated
using (
  created_by = auth.uid()
  and exists (
    select 1
    from public.audit_findings f
    join public.audits a on a.id = f.audit_id
    where f.id = finding_id
      and public.has_external_organization_scope('supplier', a.external_organization_id)
  )
)
with check (created_by = auth.uid());

-- RLS de clientes y Root2Cause.
alter table public.quality_cases enable row level security;
alter table public.corrective_actions enable row level security;
alter table public.corrective_action_a3 enable row level security;
alter table public.corrective_action_plans enable row level security;
alter table public.corrective_action_effectiveness_reviews enable row level security;

create policy quality_cases_select_scope on public.quality_cases
for select to authenticated
using (
  public.is_administrator()
  or (public.is_internal_user() and public.has_module_permission('customers', 'view'))
  or (
    portal_visible
    and public.has_external_organization_scope('customer', external_organization_id)
  )
);
create policy quality_cases_internal_write on public.quality_cases
for all to authenticated
using (public.is_internal_user() and public.has_module_permission('customers', 'update'))
with check (public.is_internal_user() and public.has_module_permission('customers', 'update'));

create policy corrective_actions_select_scope on public.corrective_actions
for select to authenticated using (public.can_access_corrective_action(id));
create policy corrective_actions_internal_write on public.corrective_actions
for all to authenticated
using (public.is_internal_user() and public.has_module_permission('corrective-actions', 'update'))
with check (public.is_internal_user() and public.has_module_permission('corrective-actions', 'update'));

create policy corrective_a3_select_scope on public.corrective_action_a3
for select to authenticated using (public.can_access_corrective_action(corrective_action_id));
create policy corrective_a3_internal_write on public.corrective_action_a3
for all to authenticated
using (public.is_internal_user() and public.can_access_corrective_action(corrective_action_id))
with check (public.is_internal_user() and public.can_access_corrective_action(corrective_action_id));

create policy corrective_plans_select_scope on public.corrective_action_plans
for select to authenticated using (public.can_access_corrective_action(corrective_action_id));
create policy corrective_plans_internal_write on public.corrective_action_plans
for all to authenticated
using (public.is_internal_user() and public.can_access_corrective_action(corrective_action_id))
with check (public.is_internal_user() and public.can_access_corrective_action(corrective_action_id));

create policy effectiveness_select_scope on public.corrective_action_effectiveness_reviews
for select to authenticated using (public.can_access_corrective_action(corrective_action_id));
create policy effectiveness_internal_write on public.corrective_action_effectiveness_reviews
for all to authenticated
using (public.is_internal_user() and public.can_access_corrective_action(corrective_action_id))
with check (public.is_internal_user() and public.can_access_corrective_action(corrective_action_id));

-- RLS de proveedores. El portal sólo consulta su supplier_id.
alter table public.supplier_quality_profiles enable row level security;
alter table public.supplier_quality_evaluations enable row level security;
alter table public.supplier_rncp_reports enable row level security;
alter table public.supplier_rncp_actions enable row level security;

create policy supplier_profiles_select_scope on public.supplier_quality_profiles
for select to authenticated
using (
  (public.is_internal_user() and public.has_module_permission('suppliers', 'view'))
  or public.has_external_organization_scope('supplier', organization_id)
);
create policy supplier_profiles_internal_write on public.supplier_quality_profiles
for all to authenticated
using (public.is_internal_user() and public.has_module_permission('suppliers', 'update'))
with check (public.is_internal_user() and public.has_module_permission('suppliers', 'update'));

create policy supplier_evaluations_select_scope on public.supplier_quality_evaluations
for select to authenticated
using (
  (public.is_internal_user() and public.has_module_permission('suppliers', 'view'))
  or public.has_external_organization_scope('supplier', supplier_id)
);
create policy supplier_evaluations_internal_write on public.supplier_quality_evaluations
for all to authenticated
using (public.is_internal_user() and public.has_module_permission('suppliers', 'update'))
with check (public.is_internal_user() and public.has_module_permission('suppliers', 'update'));

create policy supplier_rncp_select_scope on public.supplier_rncp_reports
for select to authenticated using (public.can_access_supplier_report(id));
create policy supplier_rncp_internal_write on public.supplier_rncp_reports
for all to authenticated
using (public.is_internal_user() and public.has_module_permission('suppliers', 'update'))
with check (public.is_internal_user() and public.has_module_permission('suppliers', 'update'));

create policy supplier_actions_select_scope on public.supplier_rncp_actions
for select to authenticated using (public.can_access_supplier_report(report_id));
create policy supplier_actions_internal_write on public.supplier_rncp_actions
for all to authenticated
using (public.is_internal_user() and public.has_module_permission('suppliers', 'update'))
with check (public.is_internal_user() and public.has_module_permission('suppliers', 'update'));
create policy supplier_actions_external_insert on public.supplier_rncp_actions
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.supplier_rncp_reports r
    where r.id = report_id and r.portal_visible
      and public.has_external_organization_scope('supplier', r.supplier_id)
  )
);
create policy supplier_actions_external_update on public.supplier_rncp_actions
for update to authenticated
using (
  created_by = auth.uid()
  and exists (
    select 1 from public.supplier_rncp_reports r
    where r.id = report_id
      and public.has_external_organization_scope('supplier', r.supplier_id)
  )
)
with check (created_by = auth.uid());

create view public.customer_quality_summary
with (security_invoker = true)
as
select
  o.id,
  o.code,
  o.name,
  (select count(*) from public.quality_cases q
    where q.external_organization_id = o.id and q.kind = 'claim') as claims,
  (select count(*) from public.quality_cases q
    where q.external_organization_id = o.id and q.kind = 'finding') as findings,
  (select count(*) from public.corrective_actions c
    where c.external_organization_id = o.id and c.status <> 'closed') as open_actions,
  (select min(a.scheduled_date) from public.audits a
    where a.audit_type = 'external' and a.status = 'scheduled'
      and a.scheduled_date >= current_date) as next_external_audit,
  (select count(*) from public.certifications c
    where c.active and c.customer_visible
      and (c.valid_until is null or c.valid_until >= current_date)) as certificates
from public.organizations o
where o.kind = 'customer' and o.active;

create view public.supplier_quality_summary
with (security_invoker = true)
as
select
  o.id,
  o.code,
  o.name,
  p.category,
  p.audit_required,
  p.effectiveness,
  p.current_quality_level,
  (select count(*) from public.supplier_rncp_reports r
    where r.supplier_id = o.id) as rncp_total,
  (select count(*) from public.supplier_rncp_reports r
    where r.supplier_id = o.id and r.status = 'closed') as rncp_closed,
  (select count(*) from public.supplier_rncp_reports r
    where r.supplier_id = o.id and r.status = 'late') as rncp_late,
  (select count(*) from public.supplier_rncp_reports r
    where r.supplier_id = o.id and r.status in ('open', 'in_progress')) as rncp_open,
  (select min(a.scheduled_date) from public.audits a
    where a.external_organization_id = o.id and a.audit_type = 'supplier'
      and a.status = 'scheduled' and a.scheduled_date >= current_date) as next_audit
from public.organizations o
left join public.supplier_quality_profiles p on p.organization_id = o.id
where o.kind = 'supplier' and o.active;

grant select, insert, update, delete on public.certifications to authenticated;
grant select, insert, update, delete on public.audit_programs to authenticated;
grant select, insert, update, delete on public.audit_templates to authenticated;
grant select, insert, update, delete on public.audit_template_items to authenticated;
grant select, insert, update, delete on public.audits to authenticated;
grant select, insert, update, delete on public.audit_participants to authenticated;
grant select, insert, update, delete on public.audit_responses to authenticated;
grant select, insert, update, delete on public.audit_findings to authenticated;
grant select, insert, update, delete on public.audit_finding_actions to authenticated;
grant select, insert, update, delete on public.quality_cases to authenticated;
grant select, insert, update, delete on public.corrective_actions to authenticated;
grant select, insert, update, delete on public.corrective_action_a3 to authenticated;
grant select, insert, update, delete on public.corrective_action_plans to authenticated;
grant select, insert on public.corrective_action_effectiveness_reviews to authenticated;
grant select, insert, update, delete on public.supplier_quality_profiles to authenticated;
grant select, insert, update, delete on public.supplier_quality_evaluations to authenticated;
grant select, insert, update, delete on public.supplier_rncp_reports to authenticated;
grant select, insert, update on public.supplier_rncp_actions to authenticated;
grant select on public.customer_quality_summary to authenticated;
grant select on public.supplier_quality_summary to authenticated;

comment on table public.quality_cases is
  'Reclamos y hallazgos del cliente; las acciones se generan una vez en Root2Cause.';
comment on table public.supplier_rncp_reports is
  'Fuente única del RNCP interno y del registro reflejado en el portal del proveedor.';
comment on function public.can_access_corrective_action is
  'Los clientes sólo ven acciones source=customer, portal_visible y de su organization_id.';
