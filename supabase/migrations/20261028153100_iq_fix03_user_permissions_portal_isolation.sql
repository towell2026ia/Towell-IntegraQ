-- FIX-03. Definitions only. Execution/acceptance PENDING isolated Preview.
begin;

-- External access requires a persisted allow, the correct company, an active
-- real account and production mode. No role default or stale menu can bypass it.
create or replace function public.has_module_permission(
  requested_module_id text, requested_action public.module_permission_action default 'view'
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'
    and p.user_type in ('administrator','internal')
    and (public.is_administrator() or (
      not exists (
        select 1 from public.user_permission_overrides u join public.permissions k on k.id = u.permission_id
        where u.user_id = p.id and not u.allowed and k.status = 'active'
        and k.code = any (
          case requested_module_id
          when 'customers' then array['clientes.acceder', case requested_action when 'view' then 'clientes.ver' when 'create' then 'clientes.crear' when 'update' then 'clientes.editar' when 'manage' then 'clientes.administrar' end]
          when 'suppliers' then array['proveedores.acceder', case requested_action when 'view' then 'proveedores.ver' when 'create' then 'proveedores.crear' when 'update' then 'proveedores.editar' when 'manage' then 'proveedores.administrar' end]
          when 'access' then array['usuarios.ver', case requested_action when 'create' then 'usuarios.crear' when 'update' then 'usuarios.editar' when 'manage' then 'usuarios.administrar_permisos' end]
          else array[]::text[] end
        )
      ) and (
        exists (select 1 from public.user_module_permissions m where m.user_id=p.id and m.module_id=requested_module_id
          and ((requested_action='view' and m.can_view) or (requested_action='manage' and m.can_manage)))
        or exists (select 1 from public.user_module_action_permissions a where a.user_id=p.id and a.module_id=requested_module_id and a.action=requested_action)
      )
    )));
$$;

-- Restrictive policy closes older permissive owner/shared-file policies as well.
create or replace function public.fix03_can_read_file(requested_file_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.file_objects f join public.profiles p on p.id = auth.uid() and p.status='active'
    where f.id=requested_file_id and p.workspace_mode='production'
    and (
      p.user_type='administrator'
      or (f.deleted_at is null and p.user_type='internal'
        and ((f.module_id is not null and public.has_module_permission(f.module_id,'view'))
          or (f.module_id is null and f.process_id is not null and public.has_process_access(f.process_id))))
      or (f.deleted_at is null and p.user_type in ('customer','supplier')
        and f.audience in ('shared',p.user_type::text)
        and public.has_external_organization_scope(p.external_party_kind, f.external_organization_id)
        and public.has_permission(case p.user_type when 'customer' then 'portal_clientes.acceder' else 'portal_proveedores.acceder' end,null,null,null,null,false,f.external_organization_id)
        and (p.external_site_id is null or f.external_site_id is null or p.external_site_id=f.external_site_id))
    )
  );
$$;
revoke all on function public.fix03_can_read_file(uuid) from public, anon;
grant execute on function public.fix03_can_read_file(uuid) to authenticated;

create policy fix03_file_read_gate on public.file_objects as restrictive for select to authenticated
using (public.fix03_can_read_file(id));
create policy fix03_storage_read_gate on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'integraq-private' or exists (
  select 1 from public.file_objects f where f.bucket_id=storage.objects.bucket_id
    and (f.object_path=storage.objects.name or f.preview_path=storage.objects.name)
    and public.fix03_can_read_file(f.id)
));
create policy fix03_customer_certificates on public.certifications as restrictive for select to authenticated
using (public.is_internal_user() or (
  customer_visible and active and certificate_file_id is not null and public.fix03_can_read_file(certificate_file_id)
));

-- Permission replacement is a single transaction. Lock the target profile and
-- reject stale editors. Failure at any validation/write/audit rolls everything back.
create or replace function public.save_user_access(
  requested_user_id uuid, expected_revision timestamptz, requested_account jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
  before_state jsonb;
  after_state jsonb;
  item jsonb;
  key text;
  specific jsonb;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active' for update;
  if actor.id is null or actor.user_type not in ('administrator','internal')
    or not public.has_permission('usuarios.administrar_permisos') then
    raise exception 'ACCESS_FORBIDDEN' using errcode='42501';
  end if;
  select * into target from public.profiles where id=requested_user_id for update;
  if target.id is null or actor.workspace_mode <> target.workspace_mode then
    raise exception 'ACCESS_TARGET_UNAVAILABLE' using errcode='42501';
  end if;
  if expected_revision is null or target.updated_at is distinct from expected_revision then
    raise exception 'ACCESS_STALE' using errcode='40001';
  end if;
  -- This endpoint only edits access. Identity, type, company, status and files are immutable here.
  if requested_account->>'userType' is distinct from case target.user_type
    when 'administrator' then 'Administrador' when 'internal' then 'Usuario interno'
    when 'customer' then 'Cliente' when 'supplier' then 'Proveedor' end
    or requested_account->>'status' is distinct from target.status::text then
    raise exception 'ACCESS_IDENTITY_PRESERVED';
  end if;
  if actor.user_type <> 'administrator' and (target.id=actor.id or target.user_type='administrator') then
    raise exception 'ACCESS_FORBIDDEN' using errcode='42501';
  end if;
  if jsonb_typeof(requested_account->'documentAccess') is distinct from 'array'
    or jsonb_typeof(requested_account->'moduleActionPermissions') is distinct from 'array'
    or jsonb_typeof(requested_account->'assignedModuleIds') is distinct from 'array'
    or jsonb_typeof(requested_account->'permissionChanges') is distinct from 'object' then
    raise exception 'ACCESS_INVALID';
  end if;
  specific := requested_account->'permissionChanges';
  before_state := jsonb_build_object(
    'profile',to_jsonb(target),
    'processes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.user_process_permissions x where user_id=target.id),
    'modules',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.user_module_permissions x where user_id=target.id),
    'actions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.user_module_action_permissions x where user_id=target.id),
    'overrides',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.user_permission_overrides x where user_id=target.id));
  -- There is no logical-deletion flag for these legacy assignment rows.
  -- Never remove or overwrite them. Unsupported removals fail before any write.
  if target.user_type='internal' and (
    exists (select 1 from public.user_process_permissions old where old.user_id=target.id
      and not exists (select 1 from jsonb_array_elements(requested_account->'documentAccess') d
        where d->>'processId'=old.process_id and d->>'role'=old.document_role::text))
    or exists (select 1 from public.user_module_permissions old where old.user_id=target.id and old.can_view
      and old.module_id<>'home'
      and not exists (select 1 from jsonb_array_elements_text(requested_account->'assignedModuleIds') m where m=old.module_id)
      and not exists (select 1 from jsonb_array_elements(requested_account->'moduleActionPermissions') a where a->>'moduleId'=old.module_id))
    or exists (select 1 from public.user_module_action_permissions old where old.user_id=target.id
      and not exists (select 1 from jsonb_array_elements(requested_account->'moduleActionPermissions') a
        where a->>'moduleId'=old.module_id and a->>'action'=old.action::text)
      and not (old.module_id in ('access','customers','suppliers','customer-portal','supplier-portal') and specific<>'{}'::jsonb))
  ) then raise exception 'ACCESS_EXISTING_ASSIGNMENT_PRESERVED'; end if;
  for key in select jsonb_object_keys(specific) loop
    if key not in ('usuarios.ver','usuarios.crear','usuarios.editar','usuarios.desactivar','usuarios.administrar_permisos','clientes.acceder','clientes.ver','clientes.crear','clientes.editar','clientes.administrar','portal_clientes.acceder','proveedores.acceder','proveedores.ver','proveedores.crear','proveedores.editar','proveedores.administrar','portal_proveedores.acceder','organigrama.ver','evidencias.ver')
      or jsonb_typeof(specific->key)<>'boolean'
      or not exists (select 1 from public.permissions where code=key and status='active') then
      raise exception 'ACCESS_PERMISSION_INVALID';
    end if;
    if actor.user_type<>'administrator' and specific->>key='true' and
      (key='usuarios.administrar_permisos' or not public.has_permission(key)) then
      raise exception 'ACCESS_CANNOT_DELEGATE';
    end if;
    if target.user_type in ('customer','supplier') and specific->>key='true'
      and key not in (case target.user_type when 'customer' then 'portal_clientes.acceder' else 'portal_proveedores.acceder' end,'evidencias.ver')
      then raise exception 'ACCESS_EXTERNAL_PERMISSION_INVALID'; end if;
  end loop;
  if target.user_type='internal' then
    for item in select value from jsonb_array_elements(requested_account->'documentAccess') loop
      if actor.user_type<>'administrator' and not public.has_process_document_role(item->>'processId',(item->>'role')::public.document_access_role) then raise exception 'ACCESS_CANNOT_DELEGATE'; end if;
      insert into public.user_process_permissions(user_id,process_id,document_role,source)
      values(target.id,item->>'processId',(item->>'role')::public.document_access_role,'direct') on conflict do nothing;
    end loop;
    for item in select value from jsonb_array_elements(requested_account->'moduleActionPermissions') loop
      if actor.user_type<>'administrator' and not public.has_module_permission(item->>'moduleId',(item->>'action')::public.module_permission_action) then raise exception 'ACCESS_CANNOT_DELEGATE'; end if;
      insert into public.user_module_permissions(user_id,module_id,can_view,source)
        values(target.id,item->>'moduleId',true,'direct') on conflict do nothing;
      insert into public.user_module_action_permissions(user_id,module_id,action,source)
        values(target.id,item->>'moduleId',(item->>'action')::public.module_permission_action,'direct') on conflict do nothing;
    end loop;
  end if;
  -- Only checkbox values explicitly changed and confirmed by the administrator.
  -- All unrelated overrides, inherited grants and assignment rows remain intact.
  for key in select jsonb_object_keys(specific) loop
    insert into public.user_permission_overrides(user_id,permission_id,allowed,granted_by)
      select target.id,id,(specific->>key)::boolean,actor.id from public.permissions where code=key and status='active'
    on conflict(user_id,permission_id) do update set allowed=excluded.allowed,granted_by=excluded.granted_by
      where user_permission_overrides.allowed is distinct from excluded.allowed;
  end loop;
  after_state := jsonb_build_object(
    'profile',(select to_jsonb(p) from public.profiles p where id=target.id),
    'processes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.user_process_permissions x where user_id=target.id),
    'modules',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.user_module_permissions x where user_id=target.id),
    'actions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.user_module_action_permissions x where user_id=target.id),
    'overrides',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.user_permission_overrides x where user_id=target.id));
  insert into public.audit_log(actor_id,action,resource_type,resource_id,previous_value,new_value,metadata)
    values(actor.id,'user.access_updated','profile',target.id::text,before_state,after_state,
      jsonb_build_object('workspace_mode',actor.workspace_mode,'explicit_permission_changes',specific));
  return jsonb_build_object('ok',true,'userId',target.id,'revision',(select updated_at from public.profiles where id=target.id));
end;
$$;
revoke all on function public.save_user_access(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.save_user_access(uuid,timestamptz,jsonb) to authenticated;

-- Direct override writes cannot bypass the bounded delegation RPC.
drop policy if exists user_permission_overrides_manage on public.user_permission_overrides;
create policy user_permission_overrides_manage on public.user_permission_overrides
for all to authenticated using (public.is_administrator()) with check (public.is_administrator());

create policy fix03_organization_portal_gate on public.organizations as restrictive for select to authenticated
using (public.is_internal_user() or public.has_external_organization_scope(kind,id));
create policy fix03_site_portal_gate on public.external_company_sites as restrictive for select to authenticated
using (public.is_internal_user() or (
  public.has_external_organization_scope((case public.current_user_type() when 'customer' then 'customer'::public.organization_kind when 'supplier' then 'supplier'::public.organization_kind else null end),company_id)
  and (exists (select 1 from public.profiles p where p.id=auth.uid() and (p.external_site_id is null or p.external_site_id=external_company_sites.id)))
));

create or replace function public.fix03_bump_access_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.profiles set updated_at=clock_timestamp() where id=coalesce(new.user_id,old.user_id);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.fix03_bump_access_revision() from public,anon,authenticated;
create trigger fix03_access_revision after insert or update or delete on public.user_permission_overrides for each row execute function public.fix03_bump_access_revision();
create trigger fix03_process_revision after insert or update or delete on public.user_process_permissions for each row execute function public.fix03_bump_access_revision();
create trigger fix03_module_revision after insert or update or delete on public.user_module_permissions for each row execute function public.fix03_bump_access_revision();
create trigger fix03_action_revision after insert or update or delete on public.user_module_action_permissions for each row execute function public.fix03_bump_access_revision();
create policy fix03_production_mode_gate on public.quality_cases as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.corrective_actions as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.corrective_action_a3 as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.corrective_action_plans as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.corrective_action_effectiveness_reviews as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.corrective_action_participants as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.audits as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.certifications as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.supplier_quality_profiles as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.supplier_quality_evaluations as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.supplier_rncp_reports as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.supplier_rncp_actions as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.supplier_rncp_action_evidence as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_production_mode_gate on public.supplier_assessments as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
create policy fix03_profile_mode_gate on public.profiles as restrictive for all to authenticated using (workspace_mode=public.current_workspace_mode()) with check (workspace_mode=public.current_workspace_mode());
create policy fix03_target_mode_gate on public.user_permission_overrides as restrictive for all to authenticated using (exists (select 1 from public.profiles p where p.id=user_id and p.workspace_mode=public.current_workspace_mode())) with check (exists (select 1 from public.profiles p where p.id=user_id and p.workspace_mode=public.current_workspace_mode()));
create policy fix03_target_mode_gate on public.user_module_permissions as restrictive for all to authenticated using (exists (select 1 from public.profiles p where p.id=user_id and p.workspace_mode=public.current_workspace_mode())) with check (exists (select 1 from public.profiles p where p.id=user_id and p.workspace_mode=public.current_workspace_mode()));
create policy fix03_target_mode_gate on public.user_process_permissions as restrictive for all to authenticated using (exists (select 1 from public.profiles p where p.id=user_id and p.workspace_mode=public.current_workspace_mode())) with check (exists (select 1 from public.profiles p where p.id=user_id and p.workspace_mode=public.current_workspace_mode()));
create policy fix03_target_mode_gate on public.user_module_action_permissions as restrictive for all to authenticated using (exists (select 1 from public.profiles p where p.id=user_id and p.workspace_mode=public.current_workspace_mode())) with check (exists (select 1 from public.profiles p where p.id=user_id and p.workspace_mode=public.current_workspace_mode()));
create policy fix03_company_mode_gate on public.organizations as restrictive for all to authenticated using (kind='internal' or public.current_workspace_mode()='production') with check (kind='internal' or public.current_workspace_mode()='production');
create policy fix03_site_mode_gate on public.external_company_sites as restrictive for all to authenticated using (public.current_workspace_mode()='production') with check (public.current_workspace_mode()='production');
commit;
