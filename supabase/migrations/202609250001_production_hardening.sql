-- Production hardening: server-owned workspace persistence, strict DEMO/PRODUCTION
-- isolation, soft delete and immutable audit history.

create or replace function public.current_workspace_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select profile.workspace_mode from public.profiles profile where profile.id = auth.uid()),
    'production'
  );
$$;

create table if not exists public.workspace_data (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.organizations(id) on delete restrict,
  workspace_mode text not null default 'production' check (workspace_mode in ('demo', 'production')),
  area text not null check (area ~ '^[a-z][a-zA-Z0-9]{1,63}$'),
  payload jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  deletion_reason text,
  constraint workspace_data_identity unique (workspace_id, workspace_mode, area),
  constraint workspace_data_soft_delete_reason check (
    deleted_at is null or (
      deleted_by is not null and length(trim(coalesce(deletion_reason, ''))) > 0
    )
  )
);

create index if not exists workspace_data_active_idx
  on public.workspace_data(workspace_id, workspace_mode, area)
  where deleted_at is null;

create or replace function public.prepare_workspace_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  else
    new.updated_at := now();
    new.updated_by := auth.uid();
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_data_prepare on public.workspace_data;
create trigger workspace_data_prepare
before insert or update on public.workspace_data
for each row execute function public.prepare_workspace_data();

create or replace function public.audit_workspace_data_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
begin
  audit_action := case
    when tg_op = 'INSERT' then 'CREATE'
    when old.deleted_at is null and new.deleted_at is not null then 'DELETE'
    when old.deleted_at is not null and new.deleted_at is null then 'RESTORE'
    else 'UPDATE'
  end;

  insert into public.audit_log (
    actor_id,
    organization_id,
    module,
    action,
    resource_type,
    resource_id,
    previous_value,
    new_value,
    reason,
    metadata
  ) values (
    auth.uid(),
    new.workspace_id,
    new.area,
    audit_action,
    'workspace_data',
    new.id::text,
    case when tg_op = 'UPDATE' then old.payload else null end,
    new.payload,
    new.deletion_reason,
    jsonb_build_object(
      'workspace_mode', new.workspace_mode,
      'revision', new.revision,
      'deleted_at', new.deleted_at
    )
  );
  return new;
end;
$$;

drop trigger if exists workspace_data_audit on public.workspace_data;
create trigger workspace_data_audit
after insert or update on public.workspace_data
for each row execute function public.audit_workspace_data_change();

alter table public.workspace_data enable row level security;

drop policy if exists workspace_data_select_scope on public.workspace_data;
create policy workspace_data_select_scope on public.workspace_data
for select to authenticated using (
  public.is_internal_user()
  and workspace_id in (select public.current_organization_ids())
  and workspace_mode = public.current_workspace_mode()
  and (deleted_at is null or public.is_administrator())
);

drop policy if exists workspace_data_insert_scope on public.workspace_data;
create policy workspace_data_insert_scope on public.workspace_data
for insert to authenticated with check (
  public.is_internal_user()
  and workspace_id in (select public.current_organization_ids())
  and workspace_mode = public.current_workspace_mode()
  and created_by = auth.uid()
  and updated_by = auth.uid()
  and deleted_at is null
);

drop policy if exists workspace_data_update_scope on public.workspace_data;
create policy workspace_data_update_scope on public.workspace_data
for update to authenticated using (
  public.is_internal_user()
  and workspace_id in (select public.current_organization_ids())
  and workspace_mode = public.current_workspace_mode()
  and (deleted_at is null or public.is_administrator())
) with check (
  public.is_internal_user()
  and workspace_id in (select public.current_organization_ids())
  and workspace_mode = public.current_workspace_mode()
  and updated_by = auth.uid()
);

-- Physical deletion is intentionally unavailable to authenticated clients.
revoke delete on public.workspace_data from authenticated;
grant select, insert, update on public.workspace_data to authenticated;
grant execute on function public.current_workspace_mode() to authenticated;

comment on table public.workspace_data is
  'Server-owned transition repository for operational modules formerly persisted in browser storage. Isolated by organization and workspace mode.';
