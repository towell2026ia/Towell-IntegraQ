-- Exercise the production-sized directory through both read policies with the API timeout.
insert into supplier_rncp_reports(folio,organization_id,supplier_id,created_by)
select 'LOAD-SEG-'||i,'00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000007' from generate_series(1,227) i;
begin;
set local statement_timeout='8s';
set local role authenticated;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
select test_assert((select count(*)=227 from (select id,folio from supplier_rncp_reports where folio like 'LOAD-SEG-%' order by id) r),'227 scoped reports within the eight-second API limit');
commit;
-- A single non-administrative identity with independently assignable client permissions.
insert into public.organizations(id,code,name,kind,active,owning_organization_id) values
 ('21000000-0000-4000-8000-000000000001','CC01','Synthetic client A','customer',true,'00000000-0000-4000-8000-000000000001'),
 ('21000000-0000-4000-8000-000000000002','CC02','Synthetic client B','customer',true,'00000000-0000-4000-8000-000000000002');
insert into workspace_modules values('customers'),('customer-portal');
insert into user_module_permissions(user_id,module_id) select p.id,m.id from profiles p cross join workspace_modules m where p.external_id='SYNTHETIC-2' and m.id in ('customers','customer-portal');
insert into user_permission_overrides(user_id,permission_id,allowed)
select p.id,k.id,true from profiles p cross join permissions k where p.external_id='SYNTHETIC-2' and k.code in ('portal_clientes.acceder','portal_clientes.emitir_invitaciones','portal_clientes.consultar_invitaciones');
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
select test_denied($q$insert into public.user_permission_overrides(user_id,permission_id,allowed) select auth.uid(),id,true from permissions where code='portal_clientes.revocar_invitaciones'$q$,'row-level security','cannot assign a permission in an authenticated session');
select test_assert((iq_customer_invitation_command('21000000-0000-4000-8000-000000000001','issue',null,repeat('a',64),repeat('d',64))->>'active')::boolean,'employee issues client link in own workspace');
select test_assert(not (iq_customer_invitation_command('21000000-0000-4000-8000-000000000001','status') ? 'nonce'),'view-only response contains no credential');
select test_denied($q$select iq_customer_invitation_command('21000000-0000-4000-8000-000000000002','status')$q$,'FORBIDDEN','other client workspace denied');
select test_denied($q$select iq_customer_invitation_command('21000000-0000-4000-8000-000000000001','revoke')$q$,'FORBIDDEN','issuance cannot withdraw');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000004';
select test_denied($q$select iq_customer_invitation_command('21000000-0000-4000-8000-000000000001','status')$q$,'FORBIDDEN','external supplier cannot supervise customers');
reset role;
