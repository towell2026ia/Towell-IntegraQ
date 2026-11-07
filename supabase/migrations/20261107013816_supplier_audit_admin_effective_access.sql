-- IQ-PROV-AUD-01: honor the existing inherited administrator permission.
-- Proposal only. No users, permission rows, ownership, files or RLS are changed.
-- Apply only with explicit authorization; keep both applied calendar migrations intact.
begin;
create or replace function public.iq_supplier_audit_inspector(p_org uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.organizations o on o.id=p.organization_id
  where p.id=auth.uid() and p.organization_id=p_org and p.status='active'
   and p.user_type in ('internal','administrator') and p.workspace_mode='production'
   and o.kind='internal' and o.active
   and (p.user_type='administrator' or exists(select 1 from public.user_module_action_permissions m
    where m.user_id=p.id and m.module_id='suppliers' and m.action='update'))
   and public.has_module_permission('suppliers','view') and public.has_module_permission('suppliers','update'))
$$;
revoke all on function public.iq_supplier_audit_inspector(uuid) from public,anon,authenticated;
commit;
