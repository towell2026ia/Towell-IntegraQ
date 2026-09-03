-- IntegraQ: estrategia, FODA colaborativo y ampliación SO/SOD.
-- Requiere las migraciones 202608230001..006.

update public.processes set level = 'subprocess', parent_id = 'P-17', updated_at = now() where id = 'P-18';
update public.processes set level = 'subprocess', parent_id = 'P-22', updated_at = now() where id in ('P-23', 'P-24');

create table public.strategy_cycles (
  id uuid primary key default gen_random_uuid(),
  year integer not null unique check (year between 2020 and 2200),
  status text not null default 'preparation' check (status in ('preparation', 'active', 'closed')),
  execution_opens_at date not null,
  execution_closes_at date not null,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (execution_closes_at >= execution_opens_at)
);

create table public.strategic_axes (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.strategy_cycles(id) on delete cascade,
  code text not null,
  title text not null,
  original_target text,
  review_status text not null default 'review' check (review_status in ('review', 'ready', 'published')),
  owner_id uuid references public.profiles(id) on delete set null,
  source_metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, code)
);

create table public.strategic_axis_processes (
  axis_id uuid not null references public.strategic_axes(id) on delete cascade,
  process_id text not null references public.processes(id) on delete restrict,
  primary key (axis_id, process_id)
);

create table public.strategic_axis_indicators (
  axis_id uuid not null references public.strategic_axes(id) on delete cascade,
  indicator_id uuid not null references public.indicator_definitions(id) on delete restrict,
  contribution_rule text not null default 'direct' check (contribution_rule in ('sum', 'ratio', 'weighted_average', 'direct')),
  weight numeric(7,4),
  primary key (axis_id, indicator_id)
);

create table public.strategy_import_batches (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.strategy_cycles(id) on delete cascade,
  source_name text not null,
  source_hash text not null,
  sheet_name text not null,
  status text not null default 'staged' check (status in ('staged', 'reviewed', 'published', 'failed')),
  imported_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  imported_at timestamptz not null default now(),
  unique (source_hash, sheet_name)
);

create table public.strategy_import_candidates (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.strategy_import_batches(id) on delete cascade,
  source_key text not null,
  candidate_kind text not null check (candidate_kind in ('axis', 'objective', 'key_result', 'risk', 'opportunity', 'initiative', 'control', 'activity')),
  source_value text not null,
  source_metadata jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending' check (review_status in ('pending', 'resolved', 'rejected', 'conflict')),
  review_note text,
  published_record_type text,
  published_record_id text,
  unique (batch_id, source_key, candidate_kind)
);

create table public.risk_treatments (
  code text primary key,
  label text not null unique,
  description text not null,
  sort_order smallint not null unique,
  active boolean not null default true
);

create table public.swot_registers (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.strategy_cycles(id) on delete cascade,
  process_id text not null references public.processes(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'closed')),
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, process_id)
);

create table public.swot_items (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references public.swot_registers(id) on delete cascade,
  code text not null,
  quadrant text not null check (quadrant in ('strength', 'opportunity', 'weakness', 'threat')),
  description text not null,
  strategic_axis_id uuid references public.strategic_axes(id) on delete set null,
  source_contribution_id uuid,
  status text not null default 'draft' check (status in ('draft', 'review', 'published')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (register_id, code)
);

create table public.swot_contributions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.strategy_cycles(id) on delete cascade,
  source_process_id text not null references public.processes(id) on delete restrict,
  target_process_id text not null references public.processes(id) on delete restrict,
  target_swot_item_id uuid references public.swot_items(id) on delete set null,
  suggested_quadrant text not null check (suggested_quadrant in ('strength', 'opportunity', 'weakness', 'threat')),
  comment text not null,
  observed_impact text,
  status text not null default 'pending' check (status in ('pending', 'clarification', 'incorporated', 'linked', 'dismissed')),
  resolution text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (source_process_id <> target_process_id)
);

alter table public.swot_items
  add constraint swot_items_source_contribution_fk
  foreign key (source_contribution_id) references public.swot_contributions(id) on delete set null;
create unique index swot_items_one_conversion_per_contribution
  on public.swot_items(source_contribution_id) where source_contribution_id is not null;

alter table public.risk_items
  add column if not exists strategic_axis_id uuid references public.strategic_axes(id) on delete set null,
  add column if not exists primary_indicator_id uuid references public.indicator_definitions(id) on delete set null,
  add column if not exists event text,
  add column if not exists interested_parties text,
  add column if not exists current_controls text,
  add column if not exists visibility text not null default 'internal' check (visibility in ('internal', 'shared')),
  add column if not exists evaluation_version integer not null default 1;

alter table public.risk_items
  add column if not exists treatment_code text references public.risk_treatments(code) on delete restrict;

create table public.risk_item_processes (
  risk_id uuid not null references public.risk_items(id) on delete cascade,
  process_id text not null references public.processes(id) on delete restrict,
  participation text not null default 'participant' check (participation in ('participant', 'support')),
  primary key (risk_id, process_id)
);

create table public.risk_item_swot_sources (
  risk_id uuid not null references public.risk_items(id) on delete cascade,
  swot_item_id uuid not null references public.swot_items(id) on delete restrict,
  primary key (risk_id, swot_item_id)
);

create table public.risk_item_indicators (
  risk_id uuid not null references public.risk_items(id) on delete cascade,
  indicator_id uuid not null references public.indicator_definitions(id) on delete restrict,
  primary key (risk_id, indicator_id)
);

create table public.risk_assessments (
  id uuid primary key default gen_random_uuid(),
  risk_id uuid not null references public.risk_items(id) on delete cascade,
  assessment_kind text not null check (assessment_kind in ('initial', 'reevaluation')),
  version integer not null check (version > 0),
  severity smallint check (severity between 1 and 10),
  occurrence smallint check (occurrence between 1 and 10),
  detection smallint check (detection between 1 and 10),
  so smallint generated always as (case when severity is null or occurrence is null then null else severity * occurrence end) stored,
  sod smallint generated always as (case when severity is null or occurrence is null or detection is null then null else severity * occurrence * detection end) stored,
  so_level text generated always as (case when severity is null or occurrence is null then null when severity * occurrence <= 25 then 'MENOR' when severity * occurrence <= 50 then 'MAYOR' else 'CRÍTICO' end) stored,
  severity_justification text,
  occurrence_justification text,
  detection_justification text,
  controls_snapshot text,
  scale_version text not null,
  approval_status text not null default 'draft' check (approval_status in ('draft', 'review', 'approved', 'rejected')),
  evaluated_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  evaluated_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  unique (risk_id, assessment_kind, version)
);

create table public.risk_actions (
  id uuid primary key default gen_random_uuid(),
  risk_id uuid not null references public.risk_items(id) on delete cascade,
  title text not null,
  deliverable text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  support_notes text,
  due_date date not null,
  cost numeric(14,2),
  evidence_file_id uuid references public.file_objects(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.risk_effectiveness_reviews (
  id uuid primary key default gen_random_uuid(),
  risk_id uuid not null references public.risk_items(id) on delete cascade,
  assessment_id uuid not null references public.risk_assessments(id) on delete restrict,
  success_criterion text not null,
  verified_result text not null,
  observed_from date not null,
  observed_to date not null,
  verdict text not null check (verdict in ('effective', 'not_effective', 'inconclusive')),
  decision text not null,
  next_review_at date,
  evidence_file_id uuid references public.file_objects(id) on delete set null,
  reviewed_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  reviewed_at timestamptz not null default now(),
  check (observed_to >= observed_from)
);

create or replace function public.guard_risk_assessment_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.approval_status = 'approved' then
    raise exception 'Una evaluación aprobada es inmutable; cree una nueva versión.';
  end if;
  if new.approval_status = 'approved' and new.approved_by is null then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end;
$$;

create trigger risk_assessments_version_guard
before update on public.risk_assessments
for each row execute function public.guard_risk_assessment_version();

create index strategic_axes_cycle_idx on public.strategic_axes(cycle_id);
create index swot_registers_process_cycle_idx on public.swot_registers(process_id, cycle_id);
create index swot_contributions_target_status_idx on public.swot_contributions(target_process_id, status);
create index risk_assessments_risk_version_idx on public.risk_assessments(risk_id, version desc);
create index risk_actions_owner_due_idx on public.risk_actions(owner_id, due_date) where status in ('open', 'in_progress');

alter table public.strategy_cycles enable row level security;
alter table public.strategic_axes enable row level security;
alter table public.strategic_axis_processes enable row level security;
alter table public.strategic_axis_indicators enable row level security;
alter table public.strategy_import_batches enable row level security;
alter table public.strategy_import_candidates enable row level security;
alter table public.risk_treatments enable row level security;
alter table public.swot_registers enable row level security;
alter table public.swot_items enable row level security;
alter table public.swot_contributions enable row level security;
alter table public.risk_item_processes enable row level security;
alter table public.risk_item_swot_sources enable row level security;
alter table public.risk_item_indicators enable row level security;
alter table public.risk_assessments enable row level security;
alter table public.risk_actions enable row level security;
alter table public.risk_effectiveness_reviews enable row level security;

create policy strategy_cycles_read on public.strategy_cycles for select to authenticated using (public.has_module_permission('risks', 'view'));
create policy strategy_cycles_admin on public.strategy_cycles for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy strategic_axes_read on public.strategic_axes for select to authenticated using (public.has_module_permission('risks', 'view'));
create policy strategic_axes_admin on public.strategic_axes for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy strategic_axis_processes_read on public.strategic_axis_processes for select to authenticated using (public.has_module_permission('risks', 'view') and public.has_process_access(process_id));
create policy strategic_axis_processes_admin on public.strategic_axis_processes for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy strategic_axis_indicators_read on public.strategic_axis_indicators for select to authenticated using (public.has_module_permission('risks', 'view'));
create policy strategic_axis_indicators_admin on public.strategic_axis_indicators for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy strategy_import_batches_admin on public.strategy_import_batches for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy strategy_import_candidates_admin on public.strategy_import_candidates for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy risk_treatments_read on public.risk_treatments for select to authenticated using (public.has_module_permission('risks', 'view'));
create policy risk_treatments_admin on public.risk_treatments for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy swot_registers_read on public.swot_registers for select to authenticated using (public.has_module_permission('risks', 'view') and public.has_process_access(process_id));
create policy swot_registers_write on public.swot_registers for all to authenticated using (public.has_process_document_role(process_id, 'modifier')) with check (public.has_process_document_role(process_id, 'modifier'));
create policy swot_items_read on public.swot_items for select to authenticated using (exists (select 1 from public.swot_registers r where r.id = register_id and public.has_process_access(r.process_id)));
create policy swot_items_write on public.swot_items for all to authenticated using (exists (select 1 from public.swot_registers r where r.id = register_id and public.has_process_document_role(r.process_id, 'modifier'))) with check (exists (select 1 from public.swot_registers r where r.id = register_id and public.has_process_document_role(r.process_id, 'modifier')));
create policy swot_contributions_read on public.swot_contributions for select to authenticated using (public.has_module_permission('risks', 'view') and (public.has_process_access(source_process_id) or public.has_process_access(target_process_id)));
create policy swot_contributions_insert on public.swot_contributions for insert to authenticated with check (created_by = auth.uid() and public.has_module_permission('risks', 'update') and public.has_process_access(source_process_id));
create policy swot_contributions_update on public.swot_contributions for update to authenticated using (public.has_process_document_role(target_process_id, 'modifier')) with check (public.has_process_document_role(target_process_id, 'modifier'));

create policy risk_item_processes_read on public.risk_item_processes for select to authenticated using (public.has_process_access(process_id));
create policy risk_item_processes_write on public.risk_item_processes for all to authenticated using (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier'))) with check (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier')));
create policy risk_item_swot_sources_read on public.risk_item_swot_sources for select to authenticated using (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_access(r.process_id)));
create policy risk_item_swot_sources_write on public.risk_item_swot_sources for all to authenticated using (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier'))) with check (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier')));
create policy risk_item_indicators_read on public.risk_item_indicators for select to authenticated using (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_access(r.process_id)));
create policy risk_item_indicators_write on public.risk_item_indicators for all to authenticated using (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier'))) with check (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier')));

create policy risk_assessments_read on public.risk_assessments for select to authenticated using (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_access(r.process_id)));
create policy risk_assessments_write on public.risk_assessments for all to authenticated using (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier'))) with check (evaluated_by = auth.uid() and exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier')));
create policy risk_actions_read on public.risk_actions for select to authenticated using (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_access(r.process_id)) or owner_id = auth.uid());
create policy risk_actions_write on public.risk_actions for all to authenticated using (owner_id = auth.uid() or exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier'))) with check (owner_id = auth.uid() or exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier')));
create policy risk_effectiveness_read on public.risk_effectiveness_reviews for select to authenticated using (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_access(r.process_id)));
create policy risk_effectiveness_write on public.risk_effectiveness_reviews for all to authenticated using (exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier'))) with check (reviewed_by = auth.uid() and exists (select 1 from public.risk_items i join public.risk_registers r on r.id = i.register_id where i.id = risk_id and public.has_process_document_role(r.process_id, 'modifier')));

grant select, insert, update, delete on public.strategy_cycles, public.strategic_axes, public.strategic_axis_processes, public.strategic_axis_indicators, public.strategy_import_batches, public.strategy_import_candidates, public.risk_treatments, public.swot_registers, public.swot_items, public.swot_contributions, public.risk_item_processes, public.risk_item_swot_sources, public.risk_item_indicators, public.risk_assessments, public.risk_actions, public.risk_effectiveness_reviews to authenticated;

insert into public.risk_treatments (code, label, description, sort_order) values
  ('avoid', 'EVITAR EL RIESGO.', 'Dejar de realizar o cambiar la actividad que produce esa exposición.', 1),
  ('assume_for_opportunity', 'ASUMIR EL RIESGO PARA PERSEGUIR UNA OPORTUNIDAD.', 'Aceptar una exposición evaluada para conseguir un beneficio definido.', 2),
  ('eliminate_source', 'ELIMINAR LA FUENTE DE RIESGO.', 'Quitar la causa o condición que genera el riesgo.', 3),
  ('change_probability_or_consequence', 'CAMBIAR LA PROBABILIDAD O CONSECUENCIA.', 'Reducir la posibilidad de que ocurra o la magnitud de su efecto.', 4),
  ('share', 'COMPARTIR EL RIESGO.', 'Distribuir responsabilidades y exposición con otra parte.', 5),
  ('retain_informed', 'MANTENER EL RIESGO MEDIANTE DECISIONES INFORMADAS.', 'Conservar la exposición con justificación, controles y revisión.', 6),
  ('transfer', 'TRANSFERIR EL RIESGO', 'Trasladar una parte definida de la exposición mediante un acuerdo u otro mecanismo aplicable.', 7)
on conflict (code) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;

insert into public.strategy_cycles (year, status, execution_opens_at, execution_closes_at)
values (2025, 'preparation', date '2025-01-01', date '2025-01-30')
on conflict (year) do nothing;

insert into public.strategic_axes (cycle_id, code, title, original_target, review_status, source_metadata, created_by)
select c.id, source.code, source.title, source.target, source.review_status,
  jsonb_build_object('file', 'matriz operaciones 2025 Q (003) (1).xlsx', 'sheet', 'Matriz 2025 ISO', 'cells', source.cells),
  (select id from public.profiles where user_type = 'administrator' order by created_at limit 1)
from public.strategy_cycles c
cross join (values
  ('EJE-01','Sistema de gestión integral ISO 9001 / ISO 14001','100%','ready','B12:B13'),
  ('EJE-02','Calidad','>1.5%','review','C12:C13'),
  ('EJE-03','Limpieza del Atoyac / SOAPAP','- Reducir','review','D12:D13'),
  ('EJE-04','Pruebas de laboratorio de Walmart en piso de venta','100%','review','E12:E13'),
  ('EJE-05','Eficiencia, productividad y OEE','100%','review','F12:F13'),
  ('EJE-06','Innovación de productos y mercados','100%','review','G12:G13'),
  ('EJE-07','Exportación y hotelería','20%','review','H12:H13'),
  ('EJE-08','Inventarios, lead time y dinero comprometido','380Ton','review','I12:I13'),
  ('EJE-09','Reducción de costos','- $5.00','review','J12:J13'),
  ('EJE-10','Mitigar riesgos bancarios, fiscales y de dependencias','0','review','K12:K13'),
  ('EJE-11','Utilidades','$ 10%','review','L12:L13'),
  ('EJE-12','Flujo','+','review','M12:M13')
) as source(code,title,target,review_status,cells)
where c.year = 2025
  and exists (select 1 from public.profiles where user_type = 'administrator')
on conflict (cycle_id, code) do nothing;
