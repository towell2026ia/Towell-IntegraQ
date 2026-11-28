begin;

-- Existing users receive no new grants from these catalogue entries.
insert into public.permissions(code,module,action,description,risk_level) values
 ('portal_proveedores.consultar_invitaciones','supplier-portal','consultar_invitaciones','Consultar invitaciones de proveedores','MEDIUM'),
 ('portal_proveedores.emitir_invitaciones','supplier-portal','emitir_invitaciones','Emitir invitaciones de proveedores','HIGH'),
 ('portal_proveedores.reenviar_invitaciones','supplier-portal','reenviar_invitaciones','Reenviar invitaciones de proveedores','HIGH'),
 ('portal_proveedores.revocar_invitaciones','supplier-portal','revocar_invitaciones','Revocar invitaciones de proveedores','HIGH'),
 ('portal_clientes.consultar_invitaciones','customer-portal','consultar_invitaciones','Consultar invitaciones de clientes','MEDIUM'),
 ('portal_clientes.emitir_invitaciones','customer-portal','emitir_invitaciones','Emitir invitaciones de clientes','HIGH'),
 ('portal_clientes.reenviar_invitaciones','customer-portal','reenviar_invitaciones','Reenviar invitaciones de clientes','HIGH'),
 ('portal_clientes.revocar_invitaciones','customer-portal','revocar_invitaciones','Revocar invitaciones de clientes','HIGH');

-- Uncorrelated subqueries resolve the internal identity and grants once per statement.
-- The external path retains the original membership, notification and site predicates.
alter policy supplier_rncp_select_scope on public.supplier_rncp_reports using (
 case when (select public.is_internal_user()) then
   ((select public.is_administrator()) or (deleted_at is null and
     (select public.has_module_permission('suppliers','view') and public.has_permission('proveedores.acceder') and public.has_permission('proveedores.ver'))))
 else public.can_access_supplier_report(id) end
);
alter policy rncp_organization_read_guard on public.supplier_rncp_reports using (
 case when (select public.is_internal_user()) then
   ((organization_id is null and exists (select 1 from public.profiles author where author.id=created_by and author.organization_id=(select p.organization_id from public.profiles p where p.id=(select auth.uid()))) and (supplier_id is null or exists (select 1 from public.organizations s where s.id=supplier_id and s.owning_organization_id=(select p.organization_id from public.profiles p where p.id=(select auth.uid()))))) or organization_id = (select p.organization_id from public.profiles p
     join public.organizations o on o.id=p.organization_id and o.kind='internal' and o.active
     where p.id=(select auth.uid()) and p.status='active' and coalesce(p.workspace_mode,'production')='production'
       and (select public.has_module_permission('suppliers','view'))))
 else organization_id is null or public.iq_rncp_read_scope(id) end
);

create schema if not exists integraq_private;
revoke all on schema integraq_private from public,anon;
grant usage on schema integraq_private to authenticated;

-- Narrow bridge to the installed non-public ownership check. The actor is always auth.uid().
create function integraq_private.portal_supplier_in_scope(p_supplier uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.iq_supplier_audit_supplier_allowed(p_supplier,public.iq_rncp_actor_org(false));
$$;
revoke all on function integraq_private.portal_supplier_in_scope(uuid) from public,anon;
grant execute on function integraq_private.portal_supplier_in_scope(uuid) to authenticated;

create function public.iq_supplier_dashboard_directory() returns table(id uuid,code text,name text,active boolean)
language plpgsql stable security definer set search_path='' as $$
declare org uuid:=public.iq_rncp_actor_org(false); sole boolean;
begin
 select count(*)=1 and bool_and(o.id=org) into sole from public.organizations o where o.kind='internal';
 return query select s.id,s.code,s.name,s.active from public.organizations s where s.kind='supplier'
   and (s.owning_organization_id=org or (sole and s.owning_organization_id is null)) order by s.name;
end $$;
revoke all on function public.iq_supplier_dashboard_directory() from public,anon;
grant execute on function public.iq_supplier_dashboard_directory() to authenticated;

create function public.iq_supplier_portal_staff(p_supplier uuid, p_action text)
returns uuid language plpgsql stable security invoker set search_path='' as $$
declare org uuid := public.iq_rncp_actor_org(false);
begin
 if org is null or not public.has_module_permission('supplier-portal','view')
    or not public.has_permission('portal_proveedores.acceder',org)
    or p_action is null or p_action not in ('ver','consultar','emitir','reenviar','revocar')
    or (p_action<>'ver' and not public.has_permission('portal_proveedores.'||p_action||'_invitaciones',org))
    or (p_supplier is not null and not exists (
      select 1 from public.organizations s where s.id=p_supplier and s.kind='supplier'
      and s.active and s.deleted_at is null and integraq_private.portal_supplier_in_scope(s.id)
    )) then
    raise exception using errcode='42501',message='PORTAL_SCOPE';
 end if;
 return org;
end $$;
revoke all on function public.iq_supplier_portal_staff(uuid,text) from public,anon;
grant execute on function public.iq_supplier_portal_staff(uuid,text) to authenticated;
CREATE OR REPLACE FUNCTION public.iq_supplier_portal_access(p_supplier uuid, p_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid:=case when p_action='withdraw' then public.iq_supplier_portal_staff(p_supplier,'revocar') else public.iq_supplier_portal_admin(p_supplier) end;
begin
  if p_action='withdraw' then
    update public.supplier_portal_invitations set withdrawn_at=now() where id=p_id and supplier_id=p_supplier and accepted_at is null and withdrawn_at is null;
  elsif p_action in ('revoke','reactivate') then
    update public.profiles set status=(case when p_action='revoke' then 'inactive' else 'active' end)::public.account_status
      where id=p_id and user_type='supplier' and external_party_kind='supplier' and external_party_id=p_supplier and workspace_mode='production'
        and (status='active')=(p_action='revoke') and (p_action='revoke' or external_site_id is null or exists(select 1 from public.external_company_sites s where s.id=external_site_id and s.company_id=p_supplier and s.active));
  else raise exception 'INVALID_OPERATION'; end if;
  if not found then raise exception 'ACCESS_CONFLICT'; end if;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id)
    values(auth.uid(),org,'suppliers','supplier.portal.'||p_action,'supplier_access',p_id::text);
end $function$;

CREATE OR REPLACE FUNCTION public.iq_supplier_portal_issue(p_supplier uuid, p_site uuid, p_email text, p_digest text, p_link text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid:=public.iq_supplier_portal_staff(p_supplier,'ver'); dest text:=lower(trim(p_email));
  s public.organizations%rowtype; known uuid; prof public.profiles%rowtype; ticket uuid; previous uuid;
begin
  select * into strict s from public.organizations where id=p_supplier for share;
  if not public.iq_supplier_portal_contact(p_supplier,dest) then raise exception 'CONTACT_REQUIRED'; end if;
  if p_site is not null and not exists(select 1 from public.external_company_sites where id=p_site and company_id=p_supplier and active) then raise exception 'SITE_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(dest,0));
  perform public.iq_supplier_portal_staff(p_supplier,case when exists (
    select 1 from public.supplier_portal_invitations i where i.organization_id=org and i.supplier_id=p_supplier
      and i.email=dest and i.withdrawn_at is null and i.accepted_at is null and i.blocked_at is null and i.expires_at>clock_timestamp()
  ) then 'reenviar' else 'emitir' end);
  -- The same allowance applies after withdrawal or a change of administrator/site.
  if (select count(*) from public.supplier_portal_invitations where email=dest
      and created_at>clock_timestamp()-interval '24 hours') >= 3 then raise exception 'REISSUE_LIMIT'; end if;
  perform 1 from public.supplier_portal_invitations where email=dest and accepted_at is null and withdrawn_at is null for update;
  select id into known from auth.users where lower(email)=dest;
  if known is not null then
    select * into strict prof from public.profiles where id=known for update;
    if prof.user_type<>'supplier' or prof.workspace_mode<>'production' or not (
      (prof.external_party_id=p_supplier and prof.external_site_id is not distinct from p_site and prof.status='active') is true
      or (prof.external_party_id is null and prof.status='inactive' and exists(select 1 from auth.users where id=known and
        raw_app_meta_data->>'supplier_enrollment'=p_supplier::text))) then raise exception 'IDENTITY_CONFLICT'; end if;
  end if;
  if exists(select 1 from public.supplier_portal_invitations where email=dest and supplier_id<>p_supplier and withdrawn_at is null and accepted_at is null and expires_at>now()) then raise exception 'IDENTITY_CONFLICT'; end if;
  select id into previous from public.supplier_portal_invitations where email=dest and supplier_id=p_supplier
    and organization_id=org order by created_at desc,id limit 1;
  update public.supplier_portal_invitations set withdrawn_at=clock_timestamp()
    where supplier_id=p_supplier and organization_id=org and email=dest and accepted_at is null and withdrawn_at is null;
  insert into public.supplier_portal_invitations(organization_id,supplier_id,site_id,email,token_digest,link_digest,invited_by,replaces_id)
    values(org,p_supplier,p_site,dest,p_digest,p_link,auth.uid(),previous) returning id into ticket;
  insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id)
    values(auth.uid(),org,'suppliers',case when previous is null then 'supplier.portal.invited'
      else 'supplier.portal.reissued' end,'supplier_invitation',ticket::text);
  return jsonb_build_object('id',ticket,'userId',known,'enroll',prof.external_party_id is null);
end $function$;

CREATE OR REPLACE FUNCTION public.iq_supplier_portal_issue_selected(p_supplier uuid, p_site uuid, p_email text, p_digest text, p_link text, p_replace uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  org uuid := public.iq_supplier_portal_staff(p_supplier,case when p_replace is null then 'emitir' else 'reenviar' end);
  dest text := lower(trim(p_email));
  pending uuid;
begin
  -- Use the same per-email lock as the existing issuer. Recheck after waiting.
  perform pg_advisory_xact_lock(hashtextextended(dest, 0));
  select i.id into pending from public.supplier_portal_invitations i
    where i.organization_id = org and i.supplier_id = p_supplier and i.email = dest
      and i.withdrawn_at is null and i.accepted_at is null and i.blocked_at is null
      and i.expires_at > clock_timestamp()
    for update;
  if pending is distinct from p_replace then
    raise exception 'INVITATION_CHANGED';
  end if;
  if p_replace is null and exists (
    select 1 from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = dest and p.external_party_id = p_supplier
      and p.user_type = 'supplier' and p.workspace_mode = 'production'
  ) then
    raise exception 'IDENTITY_CONFLICT';
  end if;
  return public.iq_supplier_portal_issue(p_supplier, p_site, dest, p_digest, p_link);
end $function$;

-- Keep keys out of status responses. Each mutation and its audit entry commit together.
create function public.iq_customer_invitation_command(p_customer uuid,p_action text,p_id uuid default null,
 p_nonce text default null,p_digest text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; active_link public.customer_portal_links; verb text;
begin
 select * into actor from public.profiles where id=auth.uid() and status='active' and workspace_mode='production'
   and user_type in ('internal','administrator') for share;
 verb:=case p_action when 'status' then 'consultar' when 'issue' then 'emitir' when 'obtain' then 'reenviar' when 'revoke' then 'revocar' end;
 if actor.organization_id is null or verb is null or not public.has_module_permission('customers','view') or not public.has_module_permission('customer-portal','view')
    or not public.has_permission('portal_clientes.acceder',actor.organization_id)
    or not public.has_permission('portal_clientes.'||verb||'_invitaciones',actor.organization_id)
    or exists(select 1 from public.user_permission_overrides o join public.permissions k on k.id=o.permission_id
       where o.user_id=actor.id and not o.allowed and k.status='active' and k.code in ('clientes.ver','clientes.acceder') and actor.user_type<>'administrator')
 then raise insufficient_privilege using message='CUSTOMER_PORTAL_FORBIDDEN'; end if;
 perform 1 from public.organizations c join public.organizations w on w.id=c.owning_organization_id
   where c.id=p_customer and c.kind='customer' and c.active and c.deleted_at is null and w.id=actor.organization_id and w.kind='internal' and w.active for share;
 if not found then raise insufficient_privilege using message='CUSTOMER_PORTAL_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-portal:'||p_customer::text,0));
 select * into active_link from public.customer_portal_links where customer_id=p_customer and workspace_id=actor.organization_id and revoked_at is null;
 if p_action='issue' then
   if active_link.id is not null or coalesce(p_nonce,'') !~ '^[0-9a-f]{64}$' or coalesce(p_digest,'') !~ '^[0-9a-f]{64}$' then raise exception 'CUSTOMER_LINK_CONFLICT'; end if;
   insert into public.customer_portal_links(workspace_id,customer_id,nonce,key_digest,created_by)
   values(actor.organization_id,p_customer,p_nonce,p_digest,actor.id) returning * into active_link;
 elsif p_action='revoke' then
   if active_link.id is null or (p_id is not null and active_link.id<>p_id) then raise exception 'CUSTOMER_LINK_CONFLICT'; end if;
   update public.customer_portal_links set revoked_at=now(),revoked_by=actor.id where id=active_link.id;
 end if;
 if p_action<>'status' and active_link.id is not null then
   insert into public.audit_log(actor_id,organization_id,module,action,resource_type,resource_id) values
     (actor.id,actor.organization_id,'customer-portal','customer.portal.'||p_action,'customer_invitation',active_link.id::text);
 end if;
 if active_link.id is null or p_action='revoke' then return jsonb_build_object('active',false); end if;
 if p_action='status' then return jsonb_build_object('active',true,'id',active_link.id); end if;
 return jsonb_build_object('active',true,'id',active_link.id,'nonce',active_link.nonce,'key_digest',active_link.key_digest);
end $$;
revoke all on function public.iq_customer_invitation_command(uuid,text,uuid,text,text) from public,anon;
grant execute on function public.iq_customer_invitation_command(uuid,text,uuid,text,text) to authenticated;

-- Mutation of authorization tables for an interactive session always goes through
-- the audited account service. Existing read policies continue to apply.
do $grant_guard$
declare resource text;
begin
 foreach resource in array array['user_permission_overrides','user_process_permissions','user_module_action_permissions','user_module_permissions','user_roles'] loop
   execute format('create policy seg01_account_insert on public.%I as restrictive for insert to authenticated with check(false)',resource);
   execute format('create policy seg01_account_update on public.%I as restrictive for update to authenticated using(false) with check(false)',resource);
   execute format('create policy seg01_account_delete on public.%I as restrictive for delete to authenticated using(false)',resource);
 end loop;
end $grant_guard$;

-- Executed only by the validated account service. Keep assignment sources when a row is unchanged.
create function public.iq_save_account_permissions(p_actor uuid,p_user uuid,p_revision timestamptz,p_profile jsonb,p_processes jsonb,p_modules jsonb,p_actions jsonb,p_specific jsonb,p_create boolean)
returns timestamptz language plpgsql security invoker set search_path='' as $$
declare old_profile public.profiles; desired public.profiles; actor public.profiles; revision timestamptz;
begin
 select * into strict actor from public.profiles where id=p_actor and status='active' and user_type in ('administrator','internal') and workspace_mode='production' for share;
 select * into strict old_profile from public.profiles where id=p_user for update;
 if p_actor=p_user then raise insufficient_privilege using message='SELF_PERMISSION_CHANGE'; end if;
 if not p_create and (p_revision is null or old_profile.updated_at is distinct from p_revision) then raise exception using errcode='40001',message='ACCOUNT_CHANGED'; end if;
 desired:=jsonb_populate_record(old_profile,p_profile);
 if actor.user_type<>'administrator' then raise insufficient_privilege; end if;
 if exists(select 1 from jsonb_each(p_specific) e left join public.permissions p on p.code=e.key and p.status='active' where p.id is null or jsonb_typeof(e.value) not in ('boolean','null')) then raise exception 'PERMISSION_CATALOG_CHANGED'; end if;
 -- The installed profiles_sync_access trigger rebuilds inherited grants whenever any
 -- of these three columns is targeted, including assignments of unchanged values.
 if (old_profile.position_id,old_profile.user_type,old_profile.status) is distinct from (desired.position_id,desired.user_type,desired.status) then
  update public.profiles set position_id=desired.position_id,user_type=desired.user_type,status=desired.status,full_name=desired.full_name,short_name=desired.short_name,initials=desired.initials,organization_id=desired.organization_id,
 position_name=desired.position_name,department=desired.department,company=desired.company,
 continuous_improvement_role=desired.continuous_improvement_role,external_party_kind=desired.external_party_kind,external_party_id=desired.external_party_id,
 external_party_name=desired.external_party_name,external_site_id=desired.external_site_id,site=desired.site,updated_at=clock_timestamp() where id=p_user returning updated_at into revision;
 else
  update public.profiles set full_name=desired.full_name,short_name=desired.short_name,initials=desired.initials,organization_id=desired.organization_id,
 position_name=desired.position_name,department=desired.department,company=desired.company,
 continuous_improvement_role=desired.continuous_improvement_role,external_party_kind=desired.external_party_kind,external_party_id=desired.external_party_id,
 external_party_name=desired.external_party_name,external_site_id=desired.external_site_id,site=desired.site,updated_at=clock_timestamp() where id=p_user returning updated_at into revision;
 end if;
 if desired.user_type='internal' or old_profile.user_type='internal' then
  delete from public.user_process_permissions t where t.user_id=p_user and not exists(select 1 from jsonb_array_elements(p_processes) j where j->>'processId'=t.process_id);
  insert into public.user_process_permissions(user_id,process_id,document_role,source)
  select p_user,j->>'processId',(j->>'role')::public.document_access_role,'direct' from jsonb_array_elements(p_processes) j
  on conflict(user_id,process_id) do update set document_role=excluded.document_role,source='direct',inherited_from_position_id=null
  where user_process_permissions.document_role is distinct from excluded.document_role;
  if p_actions is not null and p_modules is not null or desired.user_type is distinct from old_profile.user_type then
  delete from public.user_module_action_permissions t where t.user_id=p_user and not exists(select 1 from jsonb_array_elements(p_actions) j where j->>'moduleId'=t.module_id and j->>'action'=t.action::text);
  insert into public.user_module_action_permissions(user_id,module_id,action,source)
  select p_user,j->>'moduleId',(j->>'action')::public.module_permission_action,'direct' from jsonb_array_elements(p_actions) j on conflict do nothing;
  delete from public.user_module_permissions t where t.user_id=p_user and not exists(select 1 from jsonb_array_elements_text(p_modules) m where m=t.module_id);
  insert into public.user_module_permissions(user_id,module_id,can_view,can_manage,source)
  select p_user,m,true,exists(select 1 from jsonb_array_elements(p_actions) j where j->>'moduleId'=m and j->>'action'='manage'),'direct' from jsonb_array_elements_text(p_modules) m
  on conflict(user_id,module_id) do update set can_view=true,can_manage=excluded.can_manage,source='direct',inherited_from_position_id=null
  where not user_module_permissions.can_view or user_module_permissions.can_manage is distinct from excluded.can_manage;
  end if;
 end if;
 delete from public.user_permission_overrides o using public.permissions p,jsonb_each(p_specific) e
 where o.user_id=p_user and o.permission_id=p.id and p.code=e.key and e.value='null'::jsonb;
 insert into public.user_permission_overrides(user_id,permission_id,allowed,granted_by)
 select p_user,p.id,e.value::boolean,p_actor from jsonb_each_text(p_specific) e join public.permissions p on p.code=e.key where e.value is not null
 on conflict(user_id,permission_id) do update set allowed=excluded.allowed,granted_by=p_actor,updated_at=clock_timestamp()
 where user_permission_overrides.allowed is distinct from excluded.allowed;
 insert into public.audit_log(actor_id,organization_id,action,resource_type,resource_id,metadata) values
 (p_actor,actor.organization_id,case when p_create then 'user.created' else 'user.access_updated' end,'profile',p_user::text,
 jsonb_build_object('revision',revision,'actions',p_actions,'modules',p_modules,'processes',p_processes,'specific_permissions',p_specific));
 return revision;
end $$;
revoke all on function public.iq_save_account_permissions(uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.iq_save_account_permissions(uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) to service_role;

commit;
