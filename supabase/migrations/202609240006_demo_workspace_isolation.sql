-- Separate demonstration records from operational records at the account level.
alter table public.profiles
  add column if not exists workspace_mode text not null default 'production'
  check (workspace_mode in ('demo', 'production'));

create index if not exists profiles_workspace_mode_idx
  on public.profiles(workspace_mode, status);

update public.profiles as profile
set workspace_mode = 'demo'
from auth.users as auth_user
where auth_user.id = profile.id
  and auth_user.raw_app_meta_data ->> 'workspace_mode' = 'demo';

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_user_type public.app_user_type;
  resolved_name text;
  resolved_workspace_mode text;
begin
  resolved_user_type := case new.raw_app_meta_data ->> 'user_type'
    when 'administrator' then 'administrator'::public.app_user_type
    when 'customer' then 'customer'::public.app_user_type
    when 'supplier' then 'supplier'::public.app_user_type
    else 'internal'::public.app_user_type
  end;
  resolved_workspace_mode := case new.raw_app_meta_data ->> 'workspace_mode'
    when 'demo' then 'demo'
    else 'production'
  end;
  resolved_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.email, ''),
    'Usuario IntegraQ'
  );

  insert into public.profiles (
    id,
    external_id,
    full_name,
    user_type,
    status,
    continuous_improvement_role,
    workspace_mode
  ) values (
    new.id,
    'USR-' || upper(substr(replace(new.id::text, '-', ''), 1, 12)),
    resolved_name,
    resolved_user_type,
    case when resolved_user_type in ('customer', 'supplier') then 'inactive'::public.account_status else 'active'::public.account_status end,
    case when resolved_user_type = 'administrator' then 'manager'::public.improvement_role else 'submitter'::public.improvement_role end,
    resolved_workspace_mode
  );
  return new;
end;
$$;

comment on column public.profiles.workspace_mode is
  'Selects isolated demo or production workspaces. Demo records must never share operational record identifiers.';
