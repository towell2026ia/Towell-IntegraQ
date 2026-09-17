-- AUD-PRD-01: series, occurrences, schedule windows, standards and initial documents.
-- Evolves public.audits in place so execution/findings keep their existing foreign keys.

create table public.audit_series (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  audit_type public.audit_type not null,
  audit_subtype text,
  external_organization_id uuid references public.organizations(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid()
);

alter table public.audits
  alter column scheduled_date drop not null,
  add column if not exists audit_series_id uuid references public.audit_series(id) on delete restrict,
  add column if not exists audit_subtype text,
  add column if not exists origin_type text,
  add column if not exists entity_kind text,
  add column if not exists description text,
  add column if not exists notice_date date,
  add column if not exists notice_medium text,
  add column if not exists contact jsonb not null default '{}'::jsonb,
  add column if not exists external_auditor jsonb not null default '{}'::jsonb,
  add column if not exists schedule_type text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists window_start date,
  add column if not exists window_end date,
  add column if not exists occurrence_status text,
  add column if not exists recurrence_mode text,
  add column if not exists responsible_user_id uuid references public.profiles(id) on delete restrict;

update public.audits
set
  audit_subtype = coalesce(audit_subtype, audit_type::text),
  origin_type = coalesce(origin_type, case when audit_type = 'internal' then 'annual_plan' else 'notice' end),
  entity_kind = coalesce(entity_kind, case when audit_type = 'internal' then 'internal' else 'auditor' end),
  schedule_type = coalesce(schedule_type, 'exact'),
  start_date = coalesce(start_date, scheduled_date),
  occurrence_status = coalesce(occurrence_status, case status::text when 'scheduled' then 'scheduled' else status::text end),
  recurrence_mode = coalesce(recurrence_mode, 'no'),
  responsible_user_id = coalesce(responsible_user_id, lead_auditor_id)
where audit_subtype is null
   or origin_type is null
   or entity_kind is null
   or schedule_type is null
   or occurrence_status is null
   or recurrence_mode is null;

alter table public.audits
  add constraint audits_origin_type_check check (origin_type in ('annual_plan', 'recurrence', 'notice')) not valid,
  add constraint audits_entity_kind_check check (entity_kind in ('customer', 'certifier', 'auditor', 'internal', 'authority', 'other')) not valid,
  add constraint audits_schedule_type_check check (schedule_type in ('exact', 'range', 'window', 'pending')) not valid,
  add constraint audits_occurrence_status_check check (occurrence_status in ('draft', 'scheduled', 'window_open', 'pending_schedule', 'in_progress', 'completed', 'cancelled')) not valid,
  add constraint audits_recurrence_mode_check check (recurrence_mode in ('yes', 'no', 'after_result')) not valid,
  add constraint audits_schedule_values_check check (
    occurrence_status = 'draft'
    or (schedule_type = 'pending' and scheduled_date is null)
    or (schedule_type = 'exact' and start_date is not null)
    or (schedule_type = 'range' and start_date is not null and end_date is not null and start_date <= end_date)
    or (schedule_type = 'window' and window_start is not null and window_end is not null and window_start <= window_end)
  ) not valid,
  add constraint audits_notice_no_recurrence_check check (origin_type <> 'notice' or recurrence_mode = 'no') not valid,
  add constraint audits_customer_notice_check check (audit_type <> 'customer' or origin_type = 'notice') not valid,
  add constraint audits_confirmed_owner_check check (occurrence_status = 'draft' or responsible_user_id is not null) not valid;

create table public.audit_standard_links (
  audit_id uuid not null references public.audits(id) on delete cascade,
  standard_code text not null,
  created_at timestamptz not null default now(),
  primary key (audit_id, standard_code)
);

create table public.audit_documents (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  file_id uuid not null references public.file_objects(id) on delete restrict,
  version text,
  comment text,
  uploaded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  uploaded_at timestamptz not null default now(),
  unique (audit_id, file_id)
);

create table public.audit_code_sequences (
  year integer primary key check (year between 2020 and 2200),
  last_value integer not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.next_audit_code(requested_year integer default extract(year from current_date)::integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare next_value integer;
begin
  if requested_year not between 2020 and 2200 then
    raise exception 'Invalid audit year';
  end if;
  if not (public.is_administrator() or (public.is_internal_user() and public.has_module_permission('audits', 'manage'))) then
    raise exception 'Insufficient permission to generate an audit code';
  end if;
  insert into public.audit_code_sequences(year, last_value)
  values (requested_year, 1)
  on conflict (year) do update
    set last_value = public.audit_code_sequences.last_value + 1,
        updated_at = now()
  returning last_value into next_value;
  return format('AUD-%s-%s', requested_year, lpad(next_value::text, 4, '0'));
end;
$$;

create or replace function public.trace_audit_occurrence_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  current_row jsonb := to_jsonb(new);
  field_name text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, new_value, metadata)
    values (auth.uid(), 'audits', 'audits.occurrence_created', 'audit', new.id::text, new.code, current_row, jsonb_build_object('process_id', new.process_id));
    return new;
  end if;

  for field_name in select key from jsonb_each(current_row)
  loop
    if (previous_row -> field_name) is distinct from (current_row -> field_name)
       and field_name not in ('updated_at') then
      insert into public.audit_log(actor_id, module, action, resource_type, resource_id, entity_code_snapshot, previous_value, new_value, metadata)
      values (
        auth.uid(),
        'audits',
        'audits.occurrence_field_changed',
        'audit',
        new.id::text,
        new.code,
        jsonb_build_object(field_name, previous_row -> field_name),
        jsonb_build_object(field_name, current_row -> field_name),
        jsonb_build_object('field', field_name, 'process_id', new.process_id)
      );
    end if;
  end loop;
  return new;
end;
$$;

create trigger audits_trace_occurrence
after insert or update on public.audits
for each row execute function public.trace_audit_occurrence_change();

create index audit_series_party_idx on public.audit_series(external_organization_id, audit_type, active);
create index audits_series_created_idx on public.audits(audit_series_id, created_at desc);
create index audits_occurrence_calendar_idx on public.audits(occurrence_status, start_date, window_start);
create index audits_duplicate_candidate_idx on public.audits(external_organization_id, audit_type, start_date, end_date);
create index audit_standard_links_code_idx on public.audit_standard_links(standard_code, audit_id);
create index audit_documents_audit_idx on public.audit_documents(audit_id, uploaded_at desc);

alter table public.audit_series enable row level security;
alter table public.audit_standard_links enable row level security;
alter table public.audit_documents enable row level security;
alter table public.audit_code_sequences enable row level security;

create policy audit_series_internal_select on public.audit_series
for select to authenticated using (public.is_administrator() or public.is_internal_user());
create policy audit_series_internal_write on public.audit_series
for all to authenticated using (public.is_internal_user() and public.has_module_permission('audits', 'manage'))
with check (public.is_internal_user() and public.has_module_permission('audits', 'manage'));

create policy audit_standard_links_select_scope on public.audit_standard_links
for select to authenticated using (public.can_access_audit(audit_id));
create policy audit_standard_links_internal_write on public.audit_standard_links
for all to authenticated using (public.is_internal_user() and public.has_module_permission('audits', 'update'))
with check (public.is_internal_user() and public.has_module_permission('audits', 'update'));

create policy audit_documents_select_scope on public.audit_documents
for select to authenticated using (public.can_access_audit(audit_id));
create policy audit_documents_internal_write on public.audit_documents
for all to authenticated using (public.is_internal_user() and public.has_module_permission('audits', 'update'))
with check (public.is_internal_user() and public.has_module_permission('audits', 'update'));

grant select, insert, update on public.audit_series to authenticated;
grant select, insert, update, delete on public.audit_standard_links to authenticated;
grant select, insert, update, delete on public.audit_documents to authenticated;
grant execute on function public.next_audit_code(integer) to authenticated;
revoke delete on public.audits from authenticated;

comment on table public.audit_series is 'Agrupación histórica; cada ejecución real permanece en public.audits como una ocurrencia independiente.';
comment on column public.audits.occurrence_status is 'Estado inicial de programación de AUD-PRD-01, separado del estado de ejecución existente.';
comment on function public.next_audit_code is 'Genera folios AUD-AAAA-0001 de forma atómica y única por año.';
