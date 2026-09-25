-- Ensure every internal/demo account has an organization-backed workspace.
update public.profiles as profile
set organization_id = organization.id,
    updated_at = now()
from public.organizations as organization
where organization.code = 'TOWELL'
  and profile.user_type in ('administrator', 'internal')
  and profile.organization_id is null;

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
  resolved_organization_id uuid;
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
  if resolved_user_type in ('administrator', 'internal') then
    select organization.id into resolved_organization_id
    from public.organizations as organization
    where organization.code = 'TOWELL';
  end if;

  insert into public.profiles (
    id,
    external_id,
    full_name,
    organization_id,
    user_type,
    status,
    continuous_improvement_role,
    workspace_mode
  ) values (
    new.id,
    'USR-' || upper(substr(replace(new.id::text, '-', ''), 1, 12)),
    resolved_name,
    resolved_organization_id,
    resolved_user_type,
    case when resolved_user_type in ('customer', 'supplier') then 'inactive'::public.account_status else 'active'::public.account_status end,
    case when resolved_user_type = 'administrator' then 'manager'::public.improvement_role else 'submitter'::public.improvement_role end,
    resolved_workspace_mode
  );
  return new;
end;
$$;
