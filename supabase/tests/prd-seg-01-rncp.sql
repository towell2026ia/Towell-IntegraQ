-- Disposable fixture only. Shared transaction keeps the timestamps of a submitted response identical.
begin;
insert into public.supplier_rncp_reports(id,folio,supplier_id,organization_id,created_by,status,source_kind,notified_at,notification_reference,complete_submitted_at,validation_outcome,classification)
values('30000000-0000-4000-8000-000000000091','SEG-PLAN','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000007','in_progress','native',now()-interval '1 day','synthetic accepted reference',now(),'pending','QAC');
insert into public.supplier_rncp_actions(id,report_id,description,due_date,status,submitted_at,root_cause,action_plan,commitments,created_by)
values('40000000-0000-4000-8000-000000000091','30000000-0000-4000-8000-000000000091','Synthetic response',current_date,'submitted',now(),'Verified test cause','Synthetic action plan','Follow up on the recorded result','10000000-0000-4000-8000-000000000004');
commit;
update public.organizations set metadata=jsonb_build_object('supplierQualityContacts',jsonb_build_object('email','confirmed@example.invalid','emailVerified',true,'emailVerifiedAt',now()))
 where code='PR00001';
create trigger test_seg01_guard_report before update on public.supplier_rncp_reports for each row execute function public.iq_rncp_guard_report();
create trigger test_seg01_flow_guard before update on public.supplier_rncp_reports for each row execute function public.iq_rncp_flow_guard();
create trigger test_seg01_guard_action before update on public.supplier_rncp_actions for each row execute function public.iq_rncp_guard_action();
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
select test_assert(not (iq_rncp_manual_mail('30000000-0000-4000-8000-000000000091','enviar_recordatorios','90000000-0000-4000-8000-000000000091',null)->>'confirmed')::boolean,'Outlook preparation never records a delivery');
select test_assert((iq_rncp_manual_mail('30000000-0000-4000-8000-000000000091','enviar_recordatorios','90000000-0000-4000-8000-000000000091','Synthetic reference only')->>'confirmed')::boolean,'operator confirmation bound to same verified sender and recipient');
select test_denied($q$select iq_rncp_followup_command('30000000-0000-4000-8000-000000000091','approve','{"reason":"Synthetic result"}')$q$,'REQUIREMENTS_INCOMPLETE','cannot close without private evidence');
reset role;
insert into public.file_objects(id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,resource_type,resource_id,external_organization_id,uploaded_by)
values('50000000-0000-4000-8000-000000000091','integraq-private','synthetic/seg01.pdf','test.pdf','application/pdf',143,repeat('a',64),'supplier_rncp_action_evidence','40000000-0000-4000-8000-000000000091','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004');
insert into storage.objects(bucket_id,name) values('integraq-private','synthetic/seg01.pdf');
insert into public.supplier_rncp_action_evidence(action_id,file_id,created_by) values('40000000-0000-4000-8000-000000000091','50000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000004');
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
select test_assert(iq_rncp_followup_command('30000000-0000-4000-8000-000000000091','manage_plan','{"description":"Inspect the incoming material","owner":"Quality team","due":"2026-12-10"}') ? 'actionId','internal staff records an attributed action plan');
select iq_rncp_followup_command('30000000-0000-4000-8000-000000000091','validate_actions','{"reason":"Response and evidence reviewed"}');
select test_denied($q$select iq_rncp_followup_command('30000000-0000-4000-8000-000000000091','close_report','{"reason":"Premature"}')$q$,'PLAN_CLOSURE_REQUIRED','requires plan closure');
select iq_rncp_followup_command('30000000-0000-4000-8000-000000000091','verify_effectiveness','{"reason":"Outcome verified"}');
select iq_rncp_followup_command('30000000-0000-4000-8000-000000000091','close_plan','{"reason":"Actions completed"}');
select iq_rncp_followup_command('30000000-0000-4000-8000-000000000091','close_report','{"reason":"Report requirements satisfied"}');
select test_assert((select status='closed' and validated_by=auth.uid() and created_by=auth.uid() from public.supplier_rncp_reports where folio='SEG-PLAN'),'same responsible staff member can complete and close an eligible RNCP');

select test_denied($q$select save_supplier_rncp('30000000-0000-4000-8000-000000000091','reopen','{}','Justified reason')$q$,'RNCP_REOPEN_FORBIDDEN','closing does not confer reopening');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select test_assert(iq_rncp_faculty('00000000-0000-4000-8000-000000000001','reabrir_rncp'),'global administrators inherit reopening without an individual grant');
select test_denied($q$select save_supplier_rncp('30000000-0000-4000-8000-000000000091','reopen','{}','  ')$q$,'RNCP_REOPEN_REASON_REQUIRED','a reopening always requires a reason');
reset role;
set role service_role;
select iq_save_account_permissions('10000000-0000-4000-8000-000000000001',id,updated_at,'{}','[]',null,null,'{"rncp.reabrir_rncp":true}',false) from profiles where id='10000000-0000-4000-8000-000000000007';
reset role;
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
select save_supplier_rncp('30000000-0000-4000-8000-000000000091','reopen','{}','Additional evidence requires verification');
reset role;
select test_assert((select count(*)=1 from audit_log where action='rncp.reopened' and resource_id='30000000-0000-4000-8000-000000000091' and actor_id='10000000-0000-4000-8000-000000000007' and created_at is not null and reason='Additional evidence requires verification' and previous_value->>'status'='closed' and previous_value->>'closed_at' is not null and previous_value->>'validated_by'='10000000-0000-4000-8000-000000000007' and new_value->>'status'='in_progress'),'one attributed reopening with the previous closure intact');
insert into user_permission_overrides(user_id,permission_id,allowed) select '10000000-0000-4000-8000-000000000001',id,false from permissions where code='rncp.reabrir_rncp';
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select test_assert(not iq_rncp_faculty('00000000-0000-4000-8000-000000000001','reabrir_rncp'),'individual denial limits an active global administrator');
reset role;
-- Promoting an existing internal account in the fixture must activate only the global reopening default.
update profiles set user_type='administrator' where id='10000000-0000-4000-8000-000000000007';
set role service_role;
select iq_save_account_permissions('10000000-0000-4000-8000-000000000007',id,updated_at,'{}','[]',null,null,'{"rncp.reabrir_rncp":null}',false) from profiles where id='10000000-0000-4000-8000-000000000001';
select iq_save_account_permissions('10000000-0000-4000-8000-000000000001',id,updated_at,'{}','[]',null,null,'{"rncp.reabrir_rncp":null}',false) from profiles where id='10000000-0000-4000-8000-000000000007';
reset role;
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
select test_assert(iq_rncp_faculty('00000000-0000-4000-8000-000000000001','reabrir_rncp'),'a newly appointed global administrator inherits reopening');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select test_assert(iq_rncp_faculty('00000000-0000-4000-8000-000000000001','reabrir_rncp'),'removing a denial restores role inheritance');
reset role;
update profiles set user_type='internal' where id='10000000-0000-4000-8000-000000000007';
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
select test_assert(not iq_rncp_faculty('00000000-0000-4000-8000-000000000001','reabrir_rncp'),'role inheritance ends when the administrator role ends');
reset role;
