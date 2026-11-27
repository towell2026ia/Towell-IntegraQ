create role service_role;
create function public.is_internal_user() returns boolean language sql stable as $$
  select exists(select 1 from public.profiles where id=auth.uid() and status='active' and user_type in ('administrator','internal'))
$$;
create table public.audit_log(actor_id uuid, organization_id uuid, module text, action text, resource_type text,
  resource_id text, metadata jsonb, reason text);
alter table public.file_objects add column version integer, add column is_current boolean, add column replaces_file_id uuid,
  add column preview_status text, add column display_name text, add column valid_from date, add column description text,
  add column observations text, add column deleted_by uuid, add column deletion_reason text,
  add column updated_at timestamptz default clock_timestamp();
