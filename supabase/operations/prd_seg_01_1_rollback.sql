begin;
drop function public.iq_save_account_permissions(uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,boolean);
CREATE OR REPLACE FUNCTION public.iq_supplier_portal_access(p_supplier uuid, p_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid:=public.iq_supplier_portal_admin(p_supplier);
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
declare org uuid:=public.iq_supplier_portal_admin(p_supplier); dest text:=lower(trim(p_email));
  s public.organizations%rowtype; known uuid; prof public.profiles%rowtype; ticket uuid; previous uuid;
begin
  select * into strict s from public.organizations where id=p_supplier for share;
  if not public.iq_supplier_portal_contact(p_supplier,dest) then raise exception 'CONTACT_REQUIRED'; end if;
  if p_site is not null and not exists(select 1 from public.external_company_sites where id=p_site and company_id=p_supplier and active) then raise exception 'SITE_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(dest,0));
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
  org uuid := public.iq_supplier_portal_admin(p_supplier);
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
alter policy supplier_rncp_select_scope on public.supplier_rncp_reports using (public.can_access_supplier_report(id));
alter policy rncp_organization_read_guard on public.supplier_rncp_reports using (organization_id is null or public.iq_rncp_read_scope(id));
do $grant_guard$
declare resource text;
begin
 foreach resource in array array['user_permission_overrides','user_process_permissions','user_module_action_permissions','user_module_permissions','user_roles'] loop
   execute format('drop policy seg01_account_insert on public.%I',resource);
   execute format('drop policy seg01_account_update on public.%I',resource);
   execute format('drop policy seg01_account_delete on public.%I',resource);
 end loop;
end $grant_guard$;
drop function public.iq_customer_invitation_command(uuid,text,uuid,text,text);
drop function public.iq_supplier_dashboard_directory();
drop function public.iq_supplier_portal_staff(uuid,text);
drop function integraq_private.portal_supplier_in_scope(uuid);
-- Preserve assigned grants and their audit history. Reverting the application removes the new controls.
update public.permissions set status='inactive' where code in ('portal_proveedores.consultar_invitaciones','portal_proveedores.emitir_invitaciones','portal_proveedores.reenviar_invitaciones','portal_proveedores.revocar_invitaciones','portal_clientes.consultar_invitaciones','portal_clientes.emitir_invitaciones','portal_clientes.reenviar_invitaciones','portal_clientes.revocar_invitaciones');
commit;
