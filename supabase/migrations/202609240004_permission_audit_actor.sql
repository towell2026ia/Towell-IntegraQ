-- Las rutas administrativas escriben con service_role después de autorizar al
-- actor. El trigger toma granted_by para conservar su identidad en audit_log.
create or replace function public.audit_user_permission_override()
returns trigger language plpgsql security definer set search_path = '' as $$
declare selected_permission text;
declare selected_user uuid;
declare selected_actor uuid;
begin
  if tg_op = 'DELETE' then
    selected_user := old.user_id;
    selected_actor := coalesce(auth.uid(), old.granted_by);
  else
    selected_user := new.user_id;
    selected_actor := coalesce(auth.uid(), new.granted_by);
  end if;
  select code into selected_permission
  from public.permissions
  where id = case when tg_op = 'DELETE' then old.permission_id else new.permission_id end;

  insert into public.audit_log(
    actor_id, action, resource_type, resource_id,
    previous_value, new_value, metadata, origin
  ) values (
    selected_actor, 'user.permission_changed', 'profile', selected_user::text,
    case when tg_op = 'INSERT' then null else jsonb_build_object('permission', selected_permission, 'allowed', old.allowed) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object('permission', selected_permission, 'allowed', new.allowed) end,
    jsonb_build_object('permission', selected_permission, 'operation', tg_op),
    case when selected_actor is not null and exists (
      select 1 from public.profiles profile
      where profile.id = selected_actor and profile.user_type = 'administrator'
    ) then 'admin_override'::public.activity_origin else 'human'::public.activity_origin end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
