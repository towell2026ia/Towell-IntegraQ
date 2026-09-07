-- PRD 02: integridad y relaciones transversales. Migración aditiva y compatible.

create or replace function public.normalize_relation_text(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(translate(trim(coalesce(value, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g'));
$$;

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  description text,
  owner_user_id uuid references public.profiles(id) on delete set null,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create index areas_organization_status_idx on public.areas(organization_id, status);
create index areas_owner_user_idx on public.areas(owner_user_id);

create trigger areas_set_updated_at
before update on public.areas
for each row execute function public.set_updated_at();

alter table public.processes
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists area_id uuid references public.areas(id) on delete restrict,
  add column if not exists code text,
  add column if not exists description text,
  add column if not exists process_owner_user_id uuid references public.profiles(id) on delete set null;

update public.processes set code = id where code is null;

with resolved as (
  select permission.process_id, min(position.organization_id::text)::uuid as organization_id
  from public.position_process_permissions permission
  join public.positions position on position.id = permission.position_id
  group by permission.process_id
  having count(distinct position.organization_id) = 1
)
update public.processes process
set organization_id = resolved.organization_id
from resolved
where process.id = resolved.process_id and process.organization_id is null;

with sole_internal as (
  select min(id::text)::uuid as organization_id
  from public.organizations
  where kind = 'internal'
  having count(*) = 1
)
update public.processes process
set organization_id = sole_internal.organization_id
from sole_internal
where process.organization_id is null;

insert into public.areas (organization_id, code, name, description)
select
  position.organization_id,
  'AR-' || upper(substr(md5(public.normalize_relation_text(position.branch)), 1, 8)),
  min(trim(position.branch)),
  'Área migrada desde la rama oficial del organigrama.'
from public.positions position
where trim(position.branch) <> ''
group by position.organization_id, public.normalize_relation_text(position.branch)
on conflict (organization_id, code) do nothing;

with candidates as (
  select permission.process_id, min(area.id::text)::uuid as area_id
  from public.position_process_permissions permission
  join public.positions position on position.id = permission.position_id
  join public.areas area
    on area.organization_id = position.organization_id
   and public.normalize_relation_text(area.name) = public.normalize_relation_text(position.branch)
  group by permission.process_id
  having count(distinct area.id) = 1
)
update public.processes process
set area_id = candidates.area_id
from candidates
where process.id = candidates.process_id and process.area_id is null;

with owners as (
  select permission.process_id, min(profile.id::text)::uuid as owner_id
  from public.position_process_permissions permission
  join public.profiles profile on profile.position_id = permission.position_id and profile.status = 'active'
  where permission.relationship = 'owner'
  group by permission.process_id
  having count(distinct profile.id) = 1
)
update public.processes process
set process_owner_user_id = owners.owner_id
from owners
where process.id = owners.process_id and process.process_owner_user_id is null;

create unique index processes_organization_code_uidx on public.processes(organization_id, code) where organization_id is not null and code is not null;
create index processes_organization_idx on public.processes(organization_id);
create index processes_area_idx on public.processes(area_id);
create index processes_owner_user_idx on public.processes(process_owner_user_id);
create index processes_parent_idx on public.processes(parent_id);

alter table public.profiles add column if not exists area_id uuid references public.areas(id) on delete set null;
update public.profiles profile
set area_id = process.area_id
from public.position_process_permissions permission
join public.processes process on process.id = permission.process_id
where permission.position_id = profile.position_id
  and profile.area_id is null
  and process.area_id is not null
  and not exists (
    select 1
    from public.position_process_permissions other_permission
    join public.processes other_process on other_process.id = other_permission.process_id
    where other_permission.position_id = profile.position_id
      and other_process.area_id is distinct from process.area_id
      and other_process.area_id is not null
  );
create index profiles_area_idx on public.profiles(area_id);

alter table public.controlled_documents
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists area_id uuid references public.areas(id) on delete restrict,
  add column if not exists owner_name_snapshot text;
update public.controlled_documents document
set organization_id = process.organization_id,
    area_id = process.area_id,
    owner_name_snapshot = coalesce(document.owner_name_snapshot, (select profile.full_name from public.profiles profile where profile.id = document.owner_id))
from public.processes process
where document.process_id = process.id;

create table public.document_processes (
  document_id uuid not null references public.controlled_documents(id) on delete cascade,
  process_id text not null references public.processes(id) on delete restrict,
  relationship_type text not null check (relationship_type in ('owner', 'applicable', 'related', 'reference', 'support')),
  created_at timestamptz not null default now(),
  primary key (document_id, process_id)
);
insert into public.document_processes (document_id, process_id, relationship_type)
select id, process_id, 'owner' from public.controlled_documents
on conflict (document_id, process_id) do nothing;
create index document_processes_process_idx on public.document_processes(process_id, relationship_type);
create index controlled_documents_organization_idx on public.controlled_documents(organization_id);
create index controlled_documents_area_idx on public.controlled_documents(area_id);
create index controlled_documents_owner_idx on public.controlled_documents(owner_id);

alter table public.indicator_definitions
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists area_id uuid references public.areas(id) on delete restrict,
  add column if not exists owner_name_snapshot text;
update public.indicator_definitions indicator
set organization_id = process.organization_id,
    area_id = process.area_id,
    owner_name_snapshot = coalesce(indicator.owner_name_snapshot, indicator.leader_name, (select profile.full_name from public.profiles profile where profile.id = indicator.leader_id))
from public.processes process
where indicator.process_id = process.id;
create index indicator_definitions_organization_idx on public.indicator_definitions(organization_id);
create index indicator_definitions_area_idx on public.indicator_definitions(area_id);
create index indicator_definitions_owner_idx on public.indicator_definitions(leader_id);

alter table public.risk_items
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists area_id uuid references public.areas(id) on delete restrict,
  add column if not exists process_id text references public.processes(id) on delete restrict,
  add column if not exists risk_scope text default 'process',
  add column if not exists owner_name_snapshot text,
  add column if not exists source_audit_id uuid references public.audits(id) on delete set null,
  add column if not exists source_corrective_action_id uuid references public.corrective_actions(id) on delete set null;
update public.risk_items risk
set process_id = register.process_id,
    organization_id = process.organization_id,
    area_id = process.area_id,
    owner_name_snapshot = coalesce(risk.owner_name_snapshot, (select profile.full_name from public.profiles profile where profile.id = risk.owner_id)),
    risk_scope = coalesce(risk.risk_scope, 'process')
from public.risk_registers register
join public.processes process on process.id = register.process_id
where risk.register_id = register.id;
insert into public.risk_item_processes (risk_id, process_id, participation)
select id, process_id, 'participant' from public.risk_items where process_id is not null
on conflict (risk_id, process_id) do nothing;
alter table public.risk_items
  add constraint risk_items_scope_relation_check check (
    (risk_scope = 'process' and process_id is not null)
    or (risk_scope = 'area' and area_id is not null)
    or (risk_scope = 'corporate' and organization_id is not null)
  ) not valid;
create index risk_items_organization_idx on public.risk_items(organization_id);
create index risk_items_area_idx on public.risk_items(area_id);
create index risk_items_process_idx on public.risk_items(process_id);
create index risk_items_owner_idx on public.risk_items(owner_id);
create index risk_item_processes_process_idx on public.risk_item_processes(process_id);

alter table public.audits
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists area_id uuid references public.areas(id) on delete restrict,
  add column if not exists scope_description text;
update public.audits audit
set organization_id = process.organization_id,
    area_id = process.area_id,
    scope_description = coalesce(audit.scope_description, audit.scope)
from public.processes process
where audit.process_id = process.id;

create table public.audit_processes (
  audit_id uuid not null references public.audits(id) on delete cascade,
  process_id text not null references public.processes(id) on delete restrict,
  scope_type text not null check (scope_type in ('primary', 'audited', 'support')),
  created_at timestamptz not null default now(),
  primary key (audit_id, process_id)
);
insert into public.audit_processes (audit_id, process_id, scope_type)
select id, process_id, 'primary' from public.audits where process_id is not null
on conflict (audit_id, process_id) do nothing;
create index audit_processes_process_idx on public.audit_processes(process_id, scope_type);
create index audits_organization_idx on public.audits(organization_id);
create index audits_area_idx on public.audits(area_id);

alter table public.audit_findings
  add column if not exists process_id text references public.processes(id) on delete restrict,
  add column if not exists corrective_action_id uuid;
update public.audit_findings finding
set process_id = audit.process_id
from public.audits audit
where finding.audit_id = audit.id and finding.process_id is null;
update public.audit_findings finding
set corrective_action_id = action.id
from public.corrective_actions action
where action.audit_finding_id = finding.id and finding.corrective_action_id is null;
alter table public.audit_findings
  add constraint audit_findings_corrective_action_fk foreign key (corrective_action_id) references public.corrective_actions(id) on delete set null;
create index audit_findings_process_idx on public.audit_findings(process_id);
create index audit_findings_corrective_action_idx on public.audit_findings(corrective_action_id);

alter type public.corrective_action_source add value if not exists 'risk';
alter type public.corrective_action_source add value if not exists 'indicator';
alter type public.corrective_action_source add value if not exists 'management_review';
alter type public.corrective_action_source add value if not exists 'metrology';
alter type public.corrective_action_source add value if not exists 'other';

alter table public.corrective_actions
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists area_id uuid references public.areas(id) on delete restrict,
  add column if not exists source_record_id text,
  add column if not exists source_risk_id uuid references public.risk_items(id) on delete set null,
  add column if not exists source_indicator_id uuid references public.indicator_definitions(id) on delete set null,
  add column if not exists source_management_review_id uuid references public.management_reviews(id) on delete set null,
  add column if not exists source_measurement_event_id uuid references public.measurement_events(id) on delete set null;
update public.corrective_actions action
set organization_id = process.organization_id,
    area_id = process.area_id,
    source_record_id = coalesce(action.source_record_id, action.audit_finding_id::text, action.quality_case_id::text)
from public.processes process
where action.process_id = process.id;
create index corrective_actions_organization_idx on public.corrective_actions(organization_id);
create index corrective_actions_area_idx on public.corrective_actions(area_id);
create index corrective_actions_source_risk_idx on public.corrective_actions(source_risk_id);
create index corrective_actions_source_indicator_idx on public.corrective_actions(source_indicator_id);

alter table public.corrective_action_a3
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists process_id text references public.processes(id) on delete restrict,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists status text default 'draft' check (status in ('draft', 'analysis', 'review', 'approved', 'closed')),
  add column if not exists created_at timestamptz;
update public.corrective_action_a3 analysis
set organization_id = action.organization_id,
    process_id = action.process_id,
    created_by = coalesce(analysis.created_by, analysis.updated_by, action.created_by),
    created_at = coalesce(analysis.created_at, action.created_at)
from public.corrective_actions action
where analysis.corrective_action_id = action.id;
alter table public.corrective_action_a3 alter column created_at set default now();
create index corrective_action_a3_process_idx on public.corrective_action_a3(process_id);

alter table public.measurement_assets
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists area_id uuid references public.areas(id) on delete restrict;
update public.measurement_assets asset
set organization_id = process.organization_id,
    area_id = process.area_id
from public.processes process
where asset.process_id = process.id;
create index measurement_assets_process_idx on public.measurement_assets(process_id);
create index measurement_assets_area_idx on public.measurement_assets(area_id);
create index measurement_assets_owner_idx on public.measurement_assets(owner_id);

alter table public.measurement_events
  add column if not exists equipment_code_snapshot text,
  add column if not exists location_snapshot text,
  add column if not exists resolution_snapshot text;
update public.measurement_events event
set equipment_code_snapshot = coalesce(event.equipment_code_snapshot, asset.code),
    location_snapshot = coalesce(event.location_snapshot, asset.location),
    resolution_snapshot = coalesce(event.resolution_snapshot, asset.resolution)
from public.measurement_assets asset
where event.asset_id = asset.id;

create table public.improvement_source_links (
  id uuid primary key default gen_random_uuid(),
  improvement_id uuid not null references public.improvement_projects(id) on delete cascade,
  source_type text not null check (source_type in ('indicator', 'risk', 'audit', 'corrective_action', 'metrology', 'document')),
  indicator_id uuid references public.indicator_definitions(id) on delete restrict,
  risk_id uuid references public.risk_items(id) on delete restrict,
  audit_id uuid references public.audits(id) on delete restrict,
  corrective_action_id uuid references public.corrective_actions(id) on delete restrict,
  measurement_asset_id uuid references public.measurement_assets(id) on delete restrict,
  document_id uuid references public.controlled_documents(id) on delete restrict,
  source_code_snapshot text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(indicator_id, risk_id, audit_id, corrective_action_id, measurement_asset_id, document_id) = 1),
  check (
    (source_type = 'indicator' and indicator_id is not null)
    or (source_type = 'risk' and risk_id is not null)
    or (source_type = 'audit' and audit_id is not null)
    or (source_type = 'corrective_action' and corrective_action_id is not null)
    or (source_type = 'metrology' and measurement_asset_id is not null)
    or (source_type = 'document' and document_id is not null)
  )
);
create index improvement_source_links_improvement_idx on public.improvement_source_links(improvement_id);
create unique index improvement_source_indicator_uidx on public.improvement_source_links(improvement_id, indicator_id) where indicator_id is not null;
create unique index improvement_source_risk_uidx on public.improvement_source_links(improvement_id, risk_id) where risk_id is not null;
create unique index improvement_source_audit_uidx on public.improvement_source_links(improvement_id, audit_id) where audit_id is not null;
create unique index improvement_source_action_uidx on public.improvement_source_links(improvement_id, corrective_action_id) where corrective_action_id is not null;
create unique index improvement_source_equipment_uidx on public.improvement_source_links(improvement_id, measurement_asset_id) where measurement_asset_id is not null;
create unique index improvement_source_document_uidx on public.improvement_source_links(improvement_id, document_id) where document_id is not null;

alter table public.improvement_projects
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists area_id uuid references public.areas(id) on delete restrict;
update public.improvement_projects improvement
set organization_id = process.organization_id,
    area_id = process.area_id
from public.processes process
where improvement.process_id = process.id;
create index improvement_projects_organization_idx on public.improvement_projects(organization_id);
create index improvement_projects_area_idx on public.improvement_projects(area_id);

create table public.management_review_source_links (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.management_reviews(id) on delete cascade,
  source_type text not null check (source_type in ('indicator', 'risk', 'audit', 'corrective_action', 'customer', 'supplier', 'metrology', 'improvement', 'document')),
  indicator_id uuid references public.indicator_definitions(id) on delete restrict,
  risk_id uuid references public.risk_items(id) on delete restrict,
  audit_id uuid references public.audits(id) on delete restrict,
  corrective_action_id uuid references public.corrective_actions(id) on delete restrict,
  external_organization_id uuid references public.organizations(id) on delete restrict,
  measurement_asset_id uuid references public.measurement_assets(id) on delete restrict,
  improvement_id uuid references public.improvement_projects(id) on delete restrict,
  document_id uuid references public.controlled_documents(id) on delete restrict,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
    check (num_nonnulls(indicator_id, risk_id, audit_id, corrective_action_id, external_organization_id, measurement_asset_id, improvement_id, document_id) = 1),
    check (
      (source_type = 'indicator' and indicator_id is not null) or
      (source_type = 'risk' and risk_id is not null) or
      (source_type = 'audit' and audit_id is not null) or
      (source_type = 'corrective_action' and corrective_action_id is not null) or
      (source_type in ('customer', 'supplier') and external_organization_id is not null) or
      (source_type = 'metrology' and measurement_asset_id is not null) or
      (source_type = 'improvement' and improvement_id is not null) or
      (source_type = 'document' and document_id is not null)
    )
  );
create index management_review_source_links_review_idx on public.management_review_source_links(review_id, source_type);

create table public.data_migration_runs (
  id text primary key,
  description text not null,
  status text not null check (status in ('running', 'completed', 'needs_review', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.migration_conflicts (
  id uuid primary key default gen_random_uuid(),
  migration_id text not null references public.data_migration_runs(id) on delete restrict,
  entity_type text not null,
  record_id text not null,
  field_name text not null,
  raw_value text,
  reason text not null,
  candidates jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'ignored')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index migration_conflicts_identity_uidx on public.migration_conflicts(migration_id, entity_type, record_id, field_name, reason);
create index migration_conflicts_status_idx on public.migration_conflicts(migration_id, status, entity_type);

create table public.migration_report (
  migration_id text not null references public.data_migration_runs(id) on delete cascade,
  entity_type text not null,
  total_records integer not null default 0,
  related_records integer not null default 0,
  unrelated_records integer not null default 0,
  ambiguous_records integer not null default 0,
  duplicate_candidates integer not null default 0,
  errors integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (migration_id, entity_type)
);

insert into public.data_migration_runs (id, description, status)
values ('PRD02-20260907', 'Normalización transversal por IDs y relaciones', 'running')
on conflict (id) do nothing;

insert into public.migration_conflicts (migration_id, entity_type, record_id, field_name, raw_value, reason)
select 'PRD02-20260907', 'process', id, 'organization_id', name, 'unmatched'
from public.processes where organization_id is null
on conflict do nothing;

insert into public.migration_conflicts (migration_id, entity_type, record_id, field_name, raw_value, reason)
select 'PRD02-20260907', 'process', id, 'area_id', name, 'unmatched_or_ambiguous'
from public.processes where area_id is null
on conflict do nothing;

insert into public.migration_conflicts (migration_id, entity_type, record_id, field_name, raw_value, reason, candidates)
select 'PRD02-20260907', 'process', min(id), 'name', min(name), 'possible_duplicate', jsonb_agg(jsonb_build_object('id', id, 'name', name) order by id)
from public.processes
group by organization_id, public.normalize_relation_text(name)
having count(*) > 1
on conflict do nothing;

insert into public.migration_conflicts (migration_id, entity_type, record_id, field_name, raw_value, reason, candidates)
select 'PRD02-20260907', 'area', min(id), 'name', min(branch), 'possible_duplicate', jsonb_agg(jsonb_build_object('positionId', id, 'name', branch) order by id)
from public.positions
group by organization_id, public.normalize_relation_text(branch)
having count(distinct trim(branch)) > 1
on conflict do nothing;

insert into public.migration_conflicts (migration_id, entity_type, record_id, field_name, raw_value, reason, candidates)
select 'PRD02-20260907', kind::text, min(id::text), 'name', min(name), 'possible_duplicate', jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
from public.organizations
where kind in ('customer', 'supplier')
group by kind, public.normalize_relation_text(name)
having count(*) > 1
on conflict do nothing;

insert into public.migration_conflicts (migration_id, entity_type, record_id, field_name, raw_value, reason, candidates)
select 'PRD02-20260907', 'user', min(id::text), 'full_name', min(full_name), 'possible_duplicate', jsonb_agg(jsonb_build_object('id', id, 'name', full_name) order by full_name)
from public.profiles
group by organization_id, public.normalize_relation_text(full_name)
having count(*) > 1
on conflict do nothing;

insert into public.migration_conflicts (migration_id, entity_type, record_id, field_name, raw_value, reason, candidates)
select 'PRD02-20260907', 'equipment', min(id::text), 'name', min(name), 'possible_duplicate', jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code) order by code)
from public.measurement_assets
group by organization_id, public.normalize_relation_text(name)
having count(*) > 1
on conflict do nothing;

insert into public.migration_report (migration_id, entity_type, total_records, related_records, unrelated_records, ambiguous_records, duplicate_candidates)
select 'PRD02-20260907', entity_type, total_records, related_records, total_records - related_records, 0,
  (select count(*) from public.migration_conflicts conflict where conflict.migration_id = 'PRD02-20260907' and conflict.entity_type = summary.entity_type and conflict.reason = 'possible_duplicate')
from (
  select 'process'::text entity_type, count(*)::integer total_records, count(organization_id)::integer related_records from public.processes
  union all select 'document', count(*)::integer, count(process_id)::integer from public.controlled_documents
  union all select 'indicator', count(*)::integer, count(process_id)::integer from public.indicator_definitions
  union all select 'risk', count(*)::integer, count(process_id)::integer from public.risk_items
  union all select 'audit', count(*)::integer, count(process_id)::integer from public.audits
  union all select 'finding', count(*)::integer, count(process_id)::integer from public.audit_findings
  union all select 'corrective_action', count(*)::integer, count(process_id)::integer from public.corrective_actions
  union all select 'equipment', count(*)::integer, count(process_id)::integer from public.measurement_assets
  union all select 'improvement', count(*)::integer, count(process_id)::integer from public.improvement_projects
) summary
on conflict (migration_id, entity_type) do update set
  total_records = excluded.total_records,
  related_records = excluded.related_records,
  unrelated_records = excluded.unrelated_records,
  ambiguous_records = excluded.ambiguous_records,
  duplicate_candidates = excluded.duplicate_candidates;

update public.migration_report report
set ambiguous_records = (
  select count(*) from public.migration_conflicts conflict
  where conflict.migration_id = report.migration_id
    and conflict.entity_type = report.entity_type
    and conflict.reason like '%ambiguous%'
);

update public.data_migration_runs
set status = case when exists (select 1 from public.migration_conflicts where migration_id = 'PRD02-20260907' and status = 'pending') then 'needs_review' else 'completed' end,
    completed_at = now()
where id = 'PRD02-20260907';

alter table public.areas enable row level security;
alter table public.document_processes enable row level security;
alter table public.audit_processes enable row level security;
alter table public.improvement_source_links enable row level security;
alter table public.management_review_source_links enable row level security;
alter table public.data_migration_runs enable row level security;
alter table public.migration_conflicts enable row level security;
alter table public.migration_report enable row level security;

create policy areas_internal_select on public.areas for select to authenticated using (public.is_administrator() or public.is_internal_user());
create policy areas_admin_write on public.areas for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy document_processes_internal_select on public.document_processes for select to authenticated using (public.is_administrator() or public.is_internal_user());
create policy audit_processes_internal_select on public.audit_processes for select to authenticated using (public.is_administrator() or public.is_internal_user());
create policy improvement_source_links_internal_select on public.improvement_source_links for select to authenticated using (public.is_administrator() or public.is_internal_user());
create policy management_review_source_links_internal_select on public.management_review_source_links for select to authenticated using (public.is_administrator() or public.is_internal_user());
create policy migration_runs_admin_select on public.data_migration_runs for select to authenticated using (public.is_administrator());
create policy migration_conflicts_admin_manage on public.migration_conflicts for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy migration_report_admin_select on public.migration_report for select to authenticated using (public.is_administrator());

grant select, insert, update on public.areas to authenticated;
grant select on public.document_processes, public.audit_processes, public.improvement_source_links, public.management_review_source_links to authenticated;
grant select, update on public.migration_conflicts to authenticated;
grant select on public.data_migration_runs, public.migration_report to authenticated;
