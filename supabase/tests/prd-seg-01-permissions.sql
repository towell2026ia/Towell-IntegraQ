-- All identities and records come from the local CI fixture.
select test_assert((select count(*)=8 from permissions where code like 'portal_%_invitaciones'),'eight independent permissions');
select test_assert(not exists(select 1 from user_permission_overrides u join permissions p on p.id=u.permission_id where p.code like 'portal_%_invitaciones'),'no automatic assignments');
insert into supplier_rncp_reports(folio,organization_id,supplier_id,created_by) select 'SEG01-'||code,owning_organization_id,id,'10000000-0000-4000-8000-000000000002' from organizations where kind='supplier';
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
select test_assert((select count(*)=1 from supplier_rncp_reports where folio like 'SEG01-%'),'internal reader restricted to owning workspace');
select test_assert(iq_supplier_portal_staff('20000000-0000-4000-8000-000000000001','ver') is not null,'internal supervision without external membership');
select test_denied($q$select iq_supplier_portal_staff('20000000-0000-4000-8000-000000000001','emitir')$q$,'PORTAL_SCOPE','no implicit issuance');
reset role;
set role service_role;
select iq_save_account_permissions('10000000-0000-4000-8000-000000000001',id,updated_at,'{}','[]','["suppliers","supplier-portal"]','[]','{"portal_proveedores.emitir_invitaciones":true}',false)
from profiles where external_id='SYNTHETIC-2';
reset role;
set role authenticated;
select test_assert(iq_supplier_portal_staff('20000000-0000-4000-8000-000000000001','emitir') is not null,'issued grant becomes effective on open session');
select test_denied($q$select iq_supplier_portal_staff('20000000-0000-4000-8000-000000000001','reenviar')$q$,'PORTAL_SCOPE','reissue remains independent');
select test_denied($q$select iq_supplier_portal_staff('20000000-0000-4000-8000-000000000001','revocar')$q$,'PORTAL_SCOPE','withdraw remains independent');
select test_assert(iq_supplier_portal_issue_selected('20000000-0000-4000-8000-000000000001',null,'member@example.invalid',repeat('1',64),repeat('2',64),null)->>'id' is not null,'synthetic individual invitation issued');
reset role;
set role service_role;
select iq_save_account_permissions('10000000-0000-4000-8000-000000000001',id,updated_at,'{}','[]','["suppliers","supplier-portal"]','[]','{"portal_proveedores.emitir_invitaciones":false,"portal_proveedores.consultar_invitaciones":true}',false)
from profiles where external_id='SYNTHETIC-2';
select test_denied($q$select iq_save_account_permissions('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','2000-01-01','{}','[]','[]','[]','{}',false)$q$,'ACCOUNT_CHANGED','outdated edits cannot overwrite a newer revision');
select test_assert((select count(*)=2 from audit_log where action='user.access_updated' and actor_id='10000000-0000-4000-8000-000000000001'),'both permission saves audited');
reset role;
set role authenticated;
select test_denied($q$select iq_supplier_portal_staff('20000000-0000-4000-8000-000000000001','emitir')$q$,'PORTAL_SCOPE','withdrawn grant denied on same session');
select test_assert(iq_supplier_portal_staff('20000000-0000-4000-8000-000000000001','consultar') is not null,'view does not require issuance');
reset role;
