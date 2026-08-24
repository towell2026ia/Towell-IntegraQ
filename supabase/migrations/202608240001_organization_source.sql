create table if not exists public.organization_sources (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  document_code text not null, document_name text not null, version text not null, revision_date date,
  original_file_name text, position_count integer not null default 0 check (position_count >= 0),
  status text not null default 'active' check (status in ('active', 'superseded')),
  created_at timestamptz not null default now(), created_by uuid references public.profiles(id),
  unique (organization_id, document_code, version)
);
alter table public.organization_sources enable row level security;
grant select, insert, update, delete on public.organization_sources to authenticated;
create policy organization_sources_internal_select on public.organization_sources for select to authenticated using (public.is_internal_user());
create policy organization_sources_admin_write on public.organization_sources for all to authenticated using (public.is_administrator()) with check (public.is_administrator());
insert into public.organization_sources (organization_id, document_code, document_name, version, revision_date, original_file_name, position_count, status)
values ('00000000-0000-0000-0000-000000000001', 'F-SGC-33', 'Organigrama General', '0', '2024-11-22', 'F-SGC-33_Organigrama General_V0.xlsm', 28, 'active')
on conflict (organization_id, document_code, version) do update set revision_date = excluded.revision_date, original_file_name = excluded.original_file_name, position_count = excluded.position_count, status = excluded.status;
