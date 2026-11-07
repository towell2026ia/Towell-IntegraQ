-- Synthetic identities and storage metadata only; executed exclusively in CI.
reset role;
insert into public.processes values('P-35','00000000-0000-4000-8000-000000000001',true),('P-SECRET','00000000-0000-4000-8000-000000000001',true);
insert into public.profiles(id,organization_id,user_type,status,workspace_mode) values
 ('10000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','internal','active','production'),
 ('10000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000001','internal','active','production'),
 ('10000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000001','internal','active','production'),
 ('10000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','internal','active','production'),
 ('10000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','administrator','active','demo'),
 ('10000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','internal','active','production');
insert into public.user_process_permissions values
 ('10000000-0000-4000-8000-000000000002','P-35','viewer'),
 ('10000000-0000-4000-8000-000000000007','P-35','modifier'),
 ('10000000-0000-4000-8000-000000000008','P-35','authorizer'),
 ('10000000-0000-4000-8000-000000000009','P-35','modifier'),
 ('10000000-0000-4000-8000-000000000010','P-OTHER','modifier'),
 ('10000000-0000-4000-8000-000000000012','P-SECRET','modifier');
insert into public.user_module_action_permissions values
 ('10000000-0000-4000-8000-000000000007','documents','view'),('10000000-0000-4000-8000-000000000007','documents','update'),
 ('10000000-0000-4000-8000-000000000008','documents','view'),('10000000-0000-4000-8000-000000000009','documents','view'),
 ('10000000-0000-4000-8000-000000000010','documents','view'),('10000000-0000-4000-8000-000000000010','documents','update'),
 ('10000000-0000-4000-8000-000000000012','documents','view'),('10000000-0000-4000-8000-000000000012','documents','update');
create temporary table upload_cases(label text primary key,payload jsonb,reservation jsonb);
grant all on upload_cases to authenticated;
create function public.test_upload_payload(code text,kind text default 'initial',doc uuid default null,base uuid default null,process text default 'P-35') returns jsonb language sql as $$
 select jsonb_build_object('code',code,'title','Official synthetic title','process',process,'type','visual-aid','kind',kind,
  'reason','Authorized isolated capture','document',doc,'base',base,'file',jsonb_build_object('name',code||'.pdf','mime','application/pdf','size',100,'sha256',repeat('a',64))) $$;
create function public.test_reserve(p jsonb) returns jsonb language sql as $$
 select public.reserve_controlled_document_upload(p->>'code',p->>'title',p->>'process',p->>'type',p->'file',p->>'kind',p->>'reason',(p->>'document')::uuid,(p->>'base')::uuid) $$;
create function public.test_commit(p jsonb,r jsonb) returns uuid language sql as $$
 select public.register_controlled_document_upload(p->>'code',p->>'title',p->>'process',p->>'type',(r->>'fileId')::uuid,p->>'kind',p->>'reason',(p->>'document')::uuid,(p->>'base')::uuid) $$;
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
insert into upload_cases values('initial',public.test_upload_payload('AV-TEST-04'),null);
update upload_cases set reservation=public.test_reserve(payload) where label='initial';
select public.test_assert((select validity_status='upload_pending' and workspace_id='00000000-0000-4000-8000-000000000001' and process_id='P-35'
 from public.file_objects where id=(select (reservation->>'fileId')::uuid from upload_cases where label='initial')),'authorized modifier reserves a private tracked reference before binary upload');
select public.test_assert((select count(*)=0 from storage.objects where name=(select reservation->>'objectPath' from upload_cases where label='initial')),'reservation does not invent a physical file');
select public.test_assert((select public.test_reserve(payload)=reservation from upload_cases where label='initial'),'same capture resumes exactly the same reservation');
select public.test_denied($q$select public.test_reserve(public.test_upload_payload('AV-TEST-04 Full title'))$q$,'INVALID_DOCUMENT_CODE','new code cannot contain a concatenated title');
select public.test_denied($q$select public.test_reserve(public.test_upload_payload('BAD-FILE')||jsonb_build_object('file',jsonb_build_object('name','unsafe.html','mime','text/html','size',10,'sha256',repeat('a',64))))$q$,'INVALID_UPLOAD_FILE','unsafe type rejected before storage');
select public.test_denied($q$select public.test_reserve(public.test_upload_payload('BAD-SIZE')||jsonb_build_object('file',jsonb_build_object('name','large.pdf','mime','application/pdf','size',52428801,'sha256',repeat('a',64))))$q$,'INVALID_UPLOAD_FILE','size enforced by server');
select public.test_denied($q$insert into storage.objects(bucket_id,name,owner_id,metadata) values('integraq-private',auth.uid()::text||'/documents/P-35/unreserved.pdf',auth.uid()::text,'{"size":100}')$q$,'row-level security','a binary cannot be uploaded without its reserved reference');
insert into storage.objects(bucket_id,name,owner_id,metadata)
 select 'integraq-private',reservation->>'objectPath',auth.uid()::text,'{"size":100,"mimetype":"application/pdf"}' from upload_cases where label='initial';
select public.test_commit(payload,reservation) as new_doc from upload_cases where label='initial' \gset
select id as v0 from public.controlled_document_versions where document_id=:'new_doc' and status='pending' \gset
select public.test_assert((select version_number=0 and status='pending' and uploaded_by=auth.uid() from public.controlled_document_versions where id=:'v0'),'new document starts pending at explicit version zero');
select public.test_assert((select code='AV-TEST-04' and title='Official synthetic title' from public.controlled_documents where id=:'new_doc'),'code and title persist independently');
select public.test_assert((select count(*)=1 from public.file_objects where id=(select (reservation->>'fileId')::uuid from upload_cases where label='initial')),'uploader can read their pending file after registration');
select public.test_assert((select public.test_commit(payload,reservation)=:'new_doc'::uuid from upload_cases where label='initial'),'lost final response can be retried without creating another version');
select public.test_assert((select public.test_reserve(payload)->>'documentId'=:'new_doc' from upload_cases where label='initial'),'reservation returns the committed receipt after a lost response');
select public.test_assert((select count(*)=1 from public.controlled_document_versions where document_id=:'new_doc'),'idempotent retries do not duplicate a version');
select public.test_denied(format('select public.review_document_version(%L,''approve'')',:'v0'),'FORBIDDEN','modifier cannot approve their own document without authorizer role');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
select public.test_assert((select count(*)=0 from public.file_objects where id=(select (reservation->>'fileId')::uuid from upload_cases where label='initial')),'ordinary viewer cannot read a pending upload');
select public.test_denied($q$select public.test_reserve(public.test_upload_payload('VIEWER-WRITE'))$q$,'FORBIDDEN','viewer cannot upload through direct RPC');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000009';
select public.test_denied($q$select public.test_reserve(public.test_upload_payload('NO-MODULE-EDIT'))$q$,'FORBIDDEN','process modifier without module edit cannot upload');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000008';
select public.test_assert((select count(*)=1 from public.file_objects where id=(select (reservation->>'fileId')::uuid from upload_cases where label='initial')),'authorized process validator can read pending original');
select public.review_document_version(:'v0','approve');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
select public.test_assert((select count(*)=1 from public.file_objects where id=(select (reservation->>'fileId')::uuid from upload_cases where label='initial')),'viewer reads current authorized original');
select public.test_assert((select count(*)=1 from storage.objects where name=(select reservation->>'objectPath' from upload_cases where label='initial')),'current PDF storage read follows the same permission');

set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
select public.test_denied($q$select public.test_reserve(public.test_upload_payload('AV-TEST-04')||'{"reason":"Another initial capture"}'::jsonb)$q$,'DOCUMENT_CODE_EXISTS','new intent with existing code requires explicit replacement');
insert into upload_cases values('version',public.test_upload_payload('AV-TEST-04','version',:'new_doc',:'v0'),null);
update upload_cases set reservation=public.test_reserve(payload) where label='version';
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'integraq-private',reservation->>'objectPath',auth.uid()::text,'{"size":100}' from upload_cases where label='version';
select public.test_commit(payload,reservation) from upload_cases where label='version';
select id as v1 from public.controlled_document_versions where document_id=:'new_doc' and status='pending' \gset
select public.test_assert((select version_number=1 and revision_sequence=0 from public.controlled_document_versions where id=:'v1'),'new version increments automatically');
select public.test_assert((select status='current' from public.controlled_document_versions where id=:'v0'),'pending version preserves the operative original');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000008';
select public.review_document_version(:'v1','approve');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
insert into upload_cases values('revision',public.test_upload_payload('AV-TEST-04','revision',:'new_doc',:'v1'),null);
update upload_cases set reservation=public.test_reserve(payload) where label='revision';
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'integraq-private',reservation->>'objectPath',auth.uid()::text,'{"size":100}' from upload_cases where label='revision';
select public.test_commit(payload,reservation) from upload_cases where label='revision';
select id as revised from public.controlled_document_versions where document_id=:'new_doc' and status='pending' \gset
select public.test_assert((select version_number=1 and revision_sequence=1 and replaces_version_id=:'v1' from public.controlled_document_versions where id=:'revised'),'revision keeps version and records prior original');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000008';
select public.review_document_version(:'revised','approve');
select public.test_assert((select count(*)=1 from public.controlled_document_versions where document_id=:'new_doc' and status='current'),'exactly one authorized current version');
select public.test_assert((select count(*)=3 from public.controlled_document_versions where document_id=:'new_doc'),'all historical versions retained');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
select public.test_assert((select count(*)=0 from public.file_objects where id=(select (reservation->>'fileId')::uuid from upload_cases where label='initial')),'ordinary viewer cannot download superseded original');
select public.test_assert((select count(*)=1 from public.controlled_document_versions where document_id=:'new_doc'),'ordinary viewer cannot enumerate restricted historical versions');
select public.test_denied(format('select public.soft_delete_document(%L,''Unprivileged removal'')',:'new_doc'),'FORBIDDEN','internal reader cannot retire document');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.test_assert((select count(*)=3 from public.file_objects where resource_id=:'new_doc'),'organization administrator can consult all preserved originals');
select public.test_denied(format('select public.soft_delete_document(%L,'''')',:'new_doc'),'REASON_REQUIRED','retirement requires reason');
select public.soft_delete_document(:'new_doc','Administrative isolated retirement');
select public.test_assert((select deleted_at is not null from public.controlled_documents where id=:'new_doc'),'retirement persisted');
select public.restore_document(:'new_doc');
select public.test_assert((select is_deleted and delete_reason='Administrative isolated retirement' from public.document_lifecycle where document_id=:'new_doc'),'restore request preserves retirement until approval');
select id as restored from public.controlled_document_versions where document_id=:'new_doc' and status='pending' \gset
select public.review_document_version(:'restored','approve');
select public.test_assert((select deleted_at is null and deletion_reason='Administrative isolated retirement' from public.controlled_documents where id=:'new_doc'),'approved recovery preserves original retirement reason');
select public.test_assert((select count(*)=3 from public.file_objects where resource_id=:'new_doc'),'recovery reuses preserved file without creating another binary');
with removed as(delete from public.file_objects where resource_id=:'new_doc' returning id) select public.test_assert((select count(*)=0 from removed),'raw physical file deletion denied even to administrator');
with removed as(delete from storage.objects where name=(select reservation->>'objectPath' from upload_cases where label='revision') returning name) select public.test_assert((select count(*)=0 from removed),'physical Storage deletion denied for a document original');
with changed as(update storage.objects set metadata='{"size":1}' where name=(select reservation->>'objectPath' from upload_cases where label='revision') returning name) select public.test_assert((select count(*)=0 from changed),'Storage upsert cannot overwrite the preserved original');
with removed as(delete from public.controlled_documents where id=:'new_doc' returning id) select public.test_assert((select count(*)=0 from removed),'direct physical document deletion denied');

-- Cross-organization administrators are not global document readers or writers.
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000005';
select public.test_assert((select count(*)=0 from public.controlled_documents where id=:'new_doc'),'administrator B cannot read organization A document');
select public.test_assert((select count(*)=0 from public.file_objects where resource_id=:'new_doc'),'administrator B cannot read organization A originals');
select public.test_assert((select count(*)=0 from public.document_lifecycle where document_id=:'new_doc'),'administrator B cannot read foreign retirement metadata');
select public.test_assert((select count(*)=0 from public.document_audit_log where document_id=:'new_doc'),'administrator B cannot read foreign documentary history');
select public.test_assert((select count(*)=0 from public.document_workflow_events where document_id=:'new_doc'),'administrator B cannot read foreign workflow events');
select public.test_denied(format('select public.soft_delete_document(%L,''Foreign retirement'')',:'new_doc'),'FORBIDDEN','administrator B cannot retire A');
select public.test_denied(format('select public.restore_document(%L)',:'new_doc'),'FORBIDDEN','administrator B cannot recover A');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000012';
select public.test_assert((select count(*)=0 from public.file_objects where resource_id=:'new_doc'),'other process editor cannot read P-35 files');
select public.test_denied($q$select public.test_reserve(public.test_upload_payload('OTHER-PROCESS'))$q$,'FORBIDDEN','other process editor cannot upload into P-35');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000011';
select public.test_assert((select count(*)=0 from public.file_objects where resource_id=:'new_doc'),'DEMO administrator cannot read production documents');
select public.test_denied($q$select public.test_reserve(public.test_upload_payload('DEMO-WRITE'))$q$,'FORBIDDEN','DEMO administrator cannot upload into production');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000003';
select public.test_denied($q$select public.test_reserve(public.test_upload_payload('CUSTOMER-WRITE'))$q$,'FORBIDDEN','customer cannot upload internal document');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000004';
select public.test_denied($q$select public.test_reserve(public.test_upload_payload('SUPPLIER-WRITE'))$q$,'FORBIDDEN','supplier cannot upload internal document');

-- A failed final transaction retains only its identified upload intent.
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
insert into upload_cases values('interrupted',public.test_upload_payload('INTERRUPTED'),null);
update upload_cases set reservation=public.test_reserve(payload) where label='interrupted';
select public.test_denied($q$select public.test_commit(payload,reservation) from upload_cases where label='interrupted'$q$,'INVALID_UPLOAD_REFERENCE','missing binary cannot create a partial document or version');
select public.test_assert((select count(*)=0 from public.controlled_documents where code='INTERRUPTED'),'failed transaction creates no incomplete document');
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'integraq-private',reservation->>'objectPath',auth.uid()::text,'{"size":100}' from upload_cases where label='interrupted';
select public.test_commit(payload,reservation) from upload_cases where label='interrupted';
select public.test_assert((select count(*)=1 from public.controlled_documents where code='INTERRUPTED'),'retry completes the same tracked upload once');
reset role;
-- Inject a failure after parent creation to exercise transaction rollback, not a mock.
create function public.fixture_fail_document_version() returns trigger language plpgsql as $$ begin
 if new.change_reason='Force isolated atomic failure' then raise exception 'SYNTHETIC_INTERMEDIATE_FAILURE'; end if; return new;
end $$;
create trigger fixture_document_version_failure before insert on public.controlled_document_versions for each row execute function public.fixture_fail_document_version();
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';
insert into upload_cases values('atomic',public.test_upload_payload('ATOMIC-FAILURE')||'{"reason":"Force isolated atomic failure"}'::jsonb,null);
update upload_cases set reservation=public.test_reserve(payload) where label='atomic';
insert into storage.objects(bucket_id,name,owner_id,metadata) select 'integraq-private',reservation->>'objectPath',auth.uid()::text,'{"size":100}' from upload_cases where label='atomic';
select public.test_denied($q$select public.test_commit(payload,reservation) from upload_cases where label='atomic'$q$,'SYNTHETIC_INTERMEDIATE_FAILURE','version failure rolls back the final transaction');
select public.test_assert((select count(*)=0 from public.controlled_documents where code='ATOMIC-FAILURE'),'no partial parent survives an intermediate failure');
select public.test_assert((select validity_status='upload_pending' and resource_id is null from public.file_objects where id=(select (reservation->>'fileId')::uuid from upload_cases where label='atomic')),'failed commit keeps the original tracked pending reference');
reset role;
drop trigger fixture_document_version_failure on public.controlled_document_versions;
select public.test_assert(not exists(select 1 from storage.objects o where o.name like '%/documents/P-35/%' and not exists(select 1 from public.file_objects f where f.bucket_id=o.bucket_id and f.object_path=o.name)),'no uploaded binary is orphaned after failed or successful attempts');
select public.test_assert((select count(*)=3 from public.file_objects where resource_id=:'new_doc'),'versions and recovery never erase historical files');
