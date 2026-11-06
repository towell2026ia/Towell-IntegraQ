-- Only the guarded ephemeral CI runner may execute this file. No real suppliers or RNCP.
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
insert into public.supplier_rncp_reports(id,folio,supplier_id,report_date,description,organization_id,source_kind,portal_visible)
values('30000000-0000-4000-8000-000000000001','TEST-RNCP-A','20000000-0000-4000-8000-000000000001',current_date-10,'Synthetic defect only','00000000-0000-4000-8000-000000000001','native',true);
select public.test_assert((select response_deadline is null from public.supplier_rncp_reports where folio='TEST-RNCP-A'),'no timer before actual notification');
select public.iq_rncp_followup_command('30000000-0000-4000-8000-000000000001','record_notification',jsonb_build_object('notifiedAt',now()-interval '8 days','reference','SYNTHETIC notification proof','containmentRequired',true,'requiredDocuments',jsonb_build_array('Plan')));
select public.test_assert((select response_deadline=notified_at+interval '7 days' from public.supplier_rncp_reports where folio='TEST-RNCP-A'),'seven days from actual notification timestamp');
select public.test_denied($q$select public.iq_rncp_followup_command('30000000-0000-4000-8000-000000000001','record_notification',jsonb_build_object('notifiedAt',now(),'reference','repeat proof'))$q$,'IMMUTABLE','notification and deadline cannot restart');
select public.test_denied($q$update public.supplier_rncp_reports set status='closed',closed_at=now() where folio='TEST-RNCP-A'$q$,'INSPECTOR','administrator cannot bypass inspector closure');
select public.iq_rncp_save_workspace('rncpFollowupSettings','{"followupEnabled":true,"emailEnabled":false}',0);
select public.test_denied($q$select public.iq_rncp_save_workspace('rncpFollowupSettings','{"emailEnabled":true}',1)$q$,'NOT_AUTHORIZED','real email cannot be activated by settings');
select public.test_denied($q$select public.iq_rncp_save_workspace('rncpFollowupSettings','{}',0)$q$,'CHANGED','optimistic concurrency for settings');

set request.jwt.claim.sub='10000000-0000-4000-8000-000000000005';
insert into public.supplier_rncp_reports(id,folio,supplier_id,report_date,description,organization_id,source_kind,portal_visible)
values('30000000-0000-4000-8000-000000000002','TEST-RNCP-B','20000000-0000-4000-8000-000000000002',current_date,'Synthetic other organization','00000000-0000-4000-8000-000000000002','native',true);
select public.test_assert((select count(*)=0 from public.supplier_rncp_reports where folio='TEST-RNCP-A'),'administrator B cannot read organization A despite permissive OR baseline');
select public.test_denied($q$select public.iq_rncp_followup_command('30000000-0000-4000-8000-000000000001','record_notification','{}')$q$,'FORBIDDEN','privileged command checks organization');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
select public.test_assert((select count(*)=1 from public.supplier_rncp_reports where folio='TEST-RNCP-A'),'authorized internal reader can consult own organization');
select public.test_assert((select count(*)=0 from public.supplier_rncp_reports where folio='TEST-RNCP-B'),'internal reader cannot consult another organization');
select public.test_denied($q$update public.supplier_rncp_reports set description='Unauthorized change' where folio='TEST-RNCP-A'$q$,'FORBIDDEN','read-only internal cannot write directly');
select public.test_denied($q$select public.iq_rncp_save_workspace('rncpAlertReviews','{}',0)$q$,'FORBIDDEN','only active administrator reviews alerts');
select public.test_denied($q$select public.iq_rncp_import_history('[]','invalid')$q$,'FORBIDDEN','reader cannot import');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000003';
select public.test_assert((select count(*)=0 from public.supplier_rncp_reports),'customer cannot access supplier RNCP');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000006';
select public.test_denied($q$select public.iq_rncp_actor_org(true)$q$,'FORBIDDEN','inactive administrator blocked');

set request.jwt.claim.sub='10000000-0000-4000-8000-000000000004';
select public.test_assert((select count(*)=1 from public.supplier_rncp_reports),'supplier A reads only own explicitly shared RNCP');
select public.test_denied($q$select public.iq_rncp_save_response(null,'30000000-0000-4000-8000-000000000001','{}')$q$,'VALID_PROGRESS','empty response is not progress');
select public.iq_rncp_save_response(null,'30000000-0000-4000-8000-000000000001',jsonb_build_object('description','Synthetic valid response','responsibleName','Test supplier','dueDate',current_date,'rootCause','Synthetic verified cause','actionPlan','Synthetic complete plan','containment','Synthetic containment','commitments','Synthetic commitments')) as action_id \gset
select public.test_assert((select first_valid_progress_at is not null and response_deadline=notified_at+interval '7 days' from public.supplier_rncp_reports where folio='TEST-RNCP-A'),'valid partial advance recorded without resetting original deadline');
select public.test_denied(format('select public.iq_rncp_followup_command(%L,%L,%L::jsonb)','30000000-0000-4000-8000-000000000001','submit_delivery',jsonb_build_object('actionId',:'action_id')),'REQUIREMENTS_INCOMPLETE','no complete delivery without evidence');

reset role;
set request.jwt.claim.sub='';
insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,resource_type,resource_id,external_organization_id,uploaded_by)
values('50000000-0000-4000-8000-000000000001','integraq-private','10000000-0000-4000-8000-000000000004/rncp/test.pdf','synthetic.pdf','application/pdf',100,repeat('a',64),'supplier_rncp_action_evidence',:'action_id','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004');
insert into storage.objects(bucket_id,name) values('integraq-private','10000000-0000-4000-8000-000000000004/rncp/test.pdf');
insert into public.supplier_rncp_action_evidence(action_id,file_id,created_by) values(:'action_id','50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004');
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000004';
select public.iq_rncp_save_response(:'action_id','30000000-0000-4000-8000-000000000001',jsonb_build_object('description','Synthetic valid response','responsibleName','Test supplier','dueDate',current_date,'rootCause','Synthetic verified cause','actionPlan','Synthetic complete plan','containment','Synthetic containment','commitments','Synthetic commitments','documentTypes',jsonb_build_object('Plan','50000000-0000-4000-8000-000000000001')));
select public.test_assert(cardinality(public.iq_rncp_missing_requirements('30000000-0000-4000-8000-000000000001',:'action_id'))=0,'complete content plus authorized private evidence satisfies requirements');
select public.iq_rncp_followup_command('30000000-0000-4000-8000-000000000001','submit_delivery',jsonb_build_object('actionId',:'action_id'));
select public.test_assert((select complete_submitted_at is not null and closed_at is null and validation_outcome='pending' from public.supplier_rncp_reports where folio='TEST-RNCP-A'),'complete delivery requests validation without closing');
select public.test_denied($q$select public.iq_rncp_followup_command('30000000-0000-4000-8000-000000000001','approve','{"reason":"self approval"}')$q$,'INSPECTOR','supplier cannot approve own response');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000008';
select public.test_assert((select count(*)=0 from public.supplier_rncp_actions where report_id='30000000-0000-4000-8000-000000000001'),'supplier B cannot read supplier A actions');
select public.test_assert((select count(*)=0 from public.file_objects where id='50000000-0000-4000-8000-000000000001'),'supplier B cannot read supplier A evidence despite permissive policy');
select public.test_assert((select count(*)=0 from storage.objects where name='10000000-0000-4000-8000-000000000004/rncp/test.pdf'),'supplier B cannot access evidence object directly');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
select public.iq_rncp_followup_command('30000000-0000-4000-8000-000000000001','reject','{"reason":"Synthetic incomplete action outcome"}');
select public.test_assert((select validation_outcome='rejected' and closed_at is null and response_deadline=notified_at+interval '7 days' from public.supplier_rncp_reports where folio='TEST-RNCP-A'),'rejection preserves deadline and delivery history');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000004';
select public.iq_rncp_followup_command('30000000-0000-4000-8000-000000000001','submit_delivery',jsonb_build_object('actionId',:'action_id'));
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
select public.iq_rncp_followup_command('30000000-0000-4000-8000-000000000001','approve','{"reason":"Synthetic complete validated delivery"}');
select public.test_assert((select status='closed' and validated_by=auth.uid() and closed_at is not null from public.supplier_rncp_reports where folio='TEST-RNCP-A'),'only confirmed inspectormp authorizes closure');

set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.iq_rncp_import_history((select jsonb_agg(jsonb_build_object('row',i+5,'sequence',i,'folio','RNCP'||lpad(i::text,4,'0'),'reportDate','2026-10-01','material','Hilo','supplierName','Synthetic supplier A','supplierCode','PR00001','supplierId','20000000-0000-4000-8000-000000000001','defect','Synthetic historical defect','actionType','Synthetic action','historicalStatus',case when i%2=0 then 'Tarde' else 'Cerrado' end,'original',jsonb_build_array(i,46300,'RNCP'||lpad(i::text,4,'0'),'Hilo','Synthetic supplier A','PR00001','Synthetic historical defect','Synthetic action',case when i%2=0 then 'Tarde' else 'Cerrado' end))) from generate_series(1,226) i),'92d6d355416f58042cc9ec4cce46721a94f054e48e1db390ac7920e87f30a1ca');
select public.test_assert((select count(*)=226 and count(notified_at)=0 and count(response_deadline)=0 and count(closed_at)=0 and bool_and(not portal_visible) from public.supplier_rncp_reports where source_kind='historical'),'exactly 226 historical records; no invented notification/closure dates or portal publication');
select public.test_denied($q$update public.supplier_rncp_reports set description='Changed original' where folio='RNCP0001'$q$,'IMMUTABLE','historical source content immutable');
select public.test_denied($q$select public.iq_rncp_followup_command((select id from public.supplier_rncp_reports where folio='RNCP0001'),'record_notification','{}')$q$,'HISTORICAL','historical records cannot trigger modern clock');
select public.test_assert((select count(*)=0 from public.supplier_rncp_notification_outbox),'history import creates no notifications');
reset role;
set request.jwt.claim.sub='';
set role service_role;
select public.test_assert(public.iq_rncp_queue_notifications('00000000-0000-4000-8000-000000000001')=0,'closed native and historical cohorts generate no notices');
reset role;
select public.test_assert((select count(*)=8 from public.profiles) and (select count(*)=4 from public.organizations),'synthetic identities preserved; no automatic accounts or supplier reassignment');
