-- IQ-PROV-AUD-01: Usuarios y acceso is the sole source of calendar permissions.
-- Proposal only. No permission grants, ownership changes, data import or emails.
-- Keep 20261106221636 intact; all existing save/file/result/history guards remain.
begin;

-- Stop if a configuration was created since review rather than silently discarding
-- a verified legacy scope. Production currently has no such configuration.
do $$
begin
 if exists(select 1 from public.workspace_data where workspace_mode='production'
  and area='supplierAuditSettings' and deleted_at is null
  and (coalesce(payload->'inspectorIds','[]'::jsonb)<>'[]'::jsonb
   or coalesce(payload->'legacySupplierIds','[]'::jsonb)<>'[]'::jsonb))
 then raise exception 'AUDIT_EXISTING_CONFIGURATION_REQUIRES_REVIEW'; end if;
end $$;

create or replace function public.iq_supplier_audit_inspector(p_org uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.organizations o on o.id=p.organization_id
  join public.user_module_action_permissions m on m.user_id=p.id
  where p.id=auth.uid() and p.organization_id=p_org and p.status='active'
   and p.user_type in ('internal','administrator') and p.workspace_mode='production'
   and o.kind='internal' and o.active and m.module_id='suppliers' and m.action='update'
   and public.has_module_permission('suppliers','view') and public.has_module_permission('suppliers','update'))
$$;

create or replace function public.iq_supplier_audit_supplier_allowed(p_supplier uuid,p_org uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.organizations owner on owner.id=p.organization_id
  join public.organizations supplier on supplier.id=p_supplier and supplier.kind='supplier'
  where p.id=auth.uid() and p.organization_id=p_org and p.status='active'
   and p.user_type in ('internal','administrator') and p.workspace_mode='production'
   and owner.kind='internal' and owner.active and public.has_module_permission('suppliers','view')
   and (supplier.owning_organization_id=p_org or (supplier.owning_organization_id is null
    and (select count(*) from public.organizations where kind='internal')=1)))
$$;

-- No parallel permission editor remains callable. Preserve its definition and any
-- historical audit records; ordinary application users can no longer invoke it.
revoke all on function public.iq_supplier_audit_configure(uuid[],uuid[],integer,text) from public,anon,authenticated;
revoke all on function public.iq_supplier_audit_inspector(uuid) from public,anon,authenticated;
revoke all on function public.iq_supplier_audit_supplier_allowed(uuid,uuid) from public,anon,authenticated;
commit;
