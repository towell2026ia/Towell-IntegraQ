-- Keep workspace identity immutable and reserve soft delete/restore for administrators.
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
    if new.workspace_id is distinct from old.workspace_id
      or new.workspace_mode is distinct from old.workspace_mode
      or new.area is distinct from old.area then
      raise exception using errcode = '42501', message = 'WORKSPACE_IDENTITY_IMMUTABLE';
    end if;
    if (
      new.deleted_at is distinct from old.deleted_at
      or new.deleted_by is distinct from old.deleted_by
      or new.deletion_reason is distinct from old.deletion_reason
    ) and not public.is_administrator() then
      raise exception using errcode = '42501', message = 'ADMIN_REQUIRED_FOR_SOFT_DELETE';
    end if;
    new.updated_at := now();
    new.updated_by := auth.uid();
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;
