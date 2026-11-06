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
select public.test_denied($q$update public.supplier_rncp_reports set complete_submitted_at=now(),validation_outcome='pending' where folio='TEST-RNCP-A'$q$,'REQUIREMENTS_INCOMPLETE','direct request cannot forge a complete delivery');
select public.test_denied($q$update public.supplier_rncp_reports set first_valid_progress_at=now()-interval '1 day' where folio='TEST-RNCP-A'$q$,'TIMESTAMP_INVALID','direct request cannot backdate first progress');

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
select public.test_denied(format('insert into public.supplier_rncp_action_evidence(action_id,file_id,created_by) values(%L,%L,auth.uid())',:'action_id','50000000-0000-4000-8000-000000000001'),'row-level security','direct request cannot link another supplier evidence');
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
select public.test_assert((public.iq_rncp_import_history((select jsonb_agg('{}'::jsonb) from generate_series(1,226)),'92d6d355416f58042cc9ec4cce46721a94f054e48e1db390ac7920e87f30a1ca')->>'alreadyImported')::integer=226,'repeat import does not duplicate historical RNCP');
reset role;
set request.jwt.claim.sub='';
set role service_role;
select public.test_assert(public.iq_rncp_queue_notifications('00000000-0000-4000-8000-000000000001')=0,'closed native and historical cohorts generate no notices');
reset role;
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
insert into public.supplier_rncp_reports(id,folio,supplier_id,report_date,description,organization_id,source_kind,portal_visible)
values('30000000-0000-4000-8000-000000000003','TEST-RNCP-LATE','20000000-0000-4000-8000-000000000001',current_date-10,'Synthetic overdue only','00000000-0000-4000-8000-000000000001','native',true);
select public.iq_rncp_followup_command('30000000-0000-4000-8000-000000000003','record_notification',jsonb_build_object('notifiedAt',now()-interval '8 days','reference','Synthetic verified communication'));
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000004';
select public.iq_rncp_save_response(null,'30000000-0000-4000-8000-000000000003',jsonb_build_object('description','Generic comment without an analysis','responsibleName','Synthetic actor','dueDate',current_date));
select public.test_assert((select first_valid_progress_at is null from public.supplier_rncp_reports where folio='TEST-RNCP-LATE'),'a generic comment does not count as valid progress');
reset role;
set request.jwt.claim.sub='';
set role service_role;
select public.test_assert(public.iq_rncp_queue_notifications('00000000-0000-4000-8000-000000000001')=4,'only verified native report queues two events for two recipients');
select public.test_assert(public.iq_rncp_queue_notifications('00000000-0000-4000-8000-000000000001')=0,'repeated evaluation creates no duplicate notification');
select public.test_assert((select bool_and(delivery_state='disabled') and count(sent_at)=0 from public.supplier_rncp_notification_outbox),'all real delivery remains disabled');
select id as notification_id from public.supplier_rncp_notification_outbox order by id limit 1 \gset
update public.supplier_rncp_notification_outbox set delivery_state='queued' where id=:'notification_id';
select (public.iq_rncp_claim_notification(:'notification_id')).lease_id as lease_id \gset
select public.test_assert(:'lease_id'::uuid is not null,'controlled synthetic dispatch acquires fenced lease');
select public.test_assert((public.iq_rncp_claim_notification(:'notification_id')).id is null,'duplicate worker cannot acquire active lease');
select public.test_assert(not public.iq_rncp_finish_notification(:'notification_id',gen_random_uuid(),'synthetic-message',null),'wrong lease cannot acknowledge delivery');
select public.test_assert(public.iq_rncp_finish_notification(:'notification_id',:'lease_id',null,'CONNECTION'),'controlled failure records categorized retry');
select public.test_assert((public.iq_rncp_claim_notification(:'notification_id')).id is null,'backoff prevents immediate duplicate retry');
reset role;
select public.test_assert((select count(*)=8 from public.profiles) and (select count(*)=4 from public.organizations),'synthetic identities preserved; no automatic accounts or supplier reassignment');
-- Original PDF registration is tested against storage metadata, never a real bucket.
insert into storage.objects(bucket_id,name) select 'integraq-private','rncp-originals/00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/synthetic-'||n||'.pdf' from generate_series(1,3) n;
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select count(*) as reports_before_pdf from public.supplier_rncp_reports \gset
select public.iq_rncp_register_original(jsonb_build_object('id','60000000-0000-4000-8000-000000000001','name','Synthetic-RNCP0999.pdf','path','rncp-originals/00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/synthetic-1.pdf','sizeBytes',100,'sha256',repeat('c',64),'mimeType','application/pdf','identity',jsonb_build_object('folio','RNCP0999','supplierCode','PR00001','ambiguous',false)),null);
select public.test_assert((select count(*)=:'reports_before_pdf'::integer from public.supplier_rncp_reports),'unmatched PDF is private pending evidence, never another RNCP');
select public.test_assert((public.iq_rncp_register_original(jsonb_build_object('id','60000000-0000-4000-8000-000000000002','name','Synthetic-copy.pdf','path','rncp-originals/00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/synthetic-2.pdf','sizeBytes',100,'sha256',repeat('c',64),'mimeType','application/pdf','identity',jsonb_build_object('folio','RNCP0999','supplierCode','PR00001')),null)->>'state')='duplicate','same PDF hash never creates another file reference or RNCP');
insert into public.supplier_rncp_reports(id,folio,supplier_id,report_date,description,organization_id,source_kind,portal_visible)
values('30000000-0000-4000-8000-000000000004','RNCP0999','20000000-0000-4000-8000-000000000001',current_date,'Synthetic PDF test only','00000000-0000-4000-8000-000000000001','native',false);
select public.iq_rncp_reconcile_original('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004');
select public.iq_rncp_register_original(jsonb_build_object('id','60000000-0000-4000-8000-000000000003','name','Synthetic-next-original.pdf','path','rncp-originals/00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/synthetic-3.pdf','sizeBytes',100,'sha256',repeat('d',64),'mimeType','application/pdf','identity',jsonb_build_object('folio','RNCP0999','supplierCode','PR00001')),'30000000-0000-4000-8000-000000000004');
reset role;
select public.test_assert((select count(*)=2 and count(*) filter(where is_current)=1 and max(version)=2 from public.file_objects where resource_type='supplier_rncp_original' and resource_id='30000000-0000-4000-8000-000000000004'),'PDF replacement preserves previous original and exactly one current reference');
select public.test_assert((select count(*)=1 from public.supplier_rncp_reports where folio='RNCP0999'),'PDF association and new original version preserve RNCP identity');
select public.test_assert((select count(*)=0 from public.notifications) and (select count(*)=0 from public.integration_outbox),'managed RNCP never enter the legacy global notification or integration dispatcher');
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.test_assert(jsonb_typeof(public.iq_rncp_requirements_summary(array['30000000-0000-4000-8000-000000000001'::uuid]))='object','authorized dashboard batch requirements query executes successfully');
reset role;
