set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.test_assert(public.inspect_controlled_document_code('TEST-DOC','P-TEST','visual-aid') is null,'new code discovery');
select public.register_controlled_document_upload('TEST-DOC','Original','P-TEST','visual-aid','30000000-0000-4000-8000-000000000001','initial','Initial') as doc \gset
select public.test_assert((select version_number=0 and revision_sequence=0 and status='pending' from public.controlled_document_versions where document_id=:'doc'),'new document starts at version zero pending');
select public.test_denied($q$select public.register_controlled_document_upload('TEST-DOC','Wrong','P-TEST','visual-aid','30000000-0000-4000-8000-000000000002','initial','Duplicate')$q$,'DOCUMENT_CODE_EXISTS','duplicate without replacement rejected');
select id as initial from public.controlled_document_versions where document_id=:'doc' \gset
select public.review_document_version(:'initial','approve');
select public.register_controlled_document_upload('TEST-DOC','Original','P-TEST','visual-aid','30000000-0000-4000-8000-000000000002','version','New version',:'doc',:'initial');
select id as v1 from public.controlled_document_versions where document_id=:'doc' order by revision desc limit 1 \gset
select public.test_assert((select version_number=1 and revision_sequence=0 and status='pending' from public.controlled_document_versions where id=:'v1'),'automatic next version');
select public.test_assert((select status='current' from public.controlled_document_versions where id=:'initial'),'pending replacement does not replace authorized file');
select public.review_document_version(:'v1','approve');
select public.register_controlled_document_upload('TEST-DOC','Original','P-TEST','visual-aid','30000000-0000-4000-8000-000000000003','revision','Correction',:'doc',:'v1');
select id as correction from public.controlled_document_versions where document_id=:'doc' order by revision desc limit 1 \gset
select public.test_assert((select version_number=1 and revision_sequence=1 and replaces_version_id=:'v1' from public.controlled_document_versions where id=:'correction'),'correction retains version and records predecessor');
select public.review_document_version(:'correction','reject','Needs correction');
select public.test_assert((select status='current' from public.controlled_document_versions where id=:'v1'),'rejection preserves authorized file');
select public.register_controlled_document_upload('TEST-DOC','Original','P-TEST','visual-aid','30000000-0000-4000-8000-000000000004','revision','Corrected',:'doc',:'correction');
select id as revised from public.controlled_document_versions where document_id=:'doc' order by revision desc limit 1 \gset
select public.review_document_version(:'revised','approve');
select public.test_assert((select count(*)=1 from public.controlled_document_versions where document_id=:'doc' and status='current'),'only one current version');
reset role;
insert into public.document_lifecycle(document_id,lifecycle_status,is_deleted,deleted_at,deleted_by,delete_reason)
 values(:'doc','deleted',true,now(),'10000000-0000-4000-8000-000000000001','Historical retirement');
update public.controlled_documents set deleted_at=now(),deleted_by='10000000-0000-4000-8000-000000000001',deletion_reason='Historical retirement' where id=:'doc';
set role authenticated;
select public.restore_document(:'doc');
select public.test_assert((select is_deleted from public.document_lifecycle where document_id=:'doc'),'restore request remains retired until authorization');
select id as restore from public.controlled_document_versions where document_id=:'doc' order by revision desc limit 1 \gset
select public.review_document_version(:'restore','reject','Use replacement file');
select public.register_controlled_document_upload('TEST-DOC','Original','P-TEST','visual-aid','30000000-0000-4000-8000-000000000005','revision','Replace retired',:'doc',:'restore');
select id as recovered from public.controlled_document_versions where document_id=:'doc' order by revision desc limit 1 \gset
select public.test_assert((select deleted_at is not null from public.controlled_documents where id=:'doc'),'retired replacement remains nonoperational before approval');
select public.review_document_version(:'recovered','approve');
select public.test_assert((select deleted_at is null and deletion_reason='Historical retirement' from public.controlled_documents where id=:'doc'),'approval reactivates identity while retaining reason');
select public.test_assert((select not is_deleted and deleted_at is not null and delete_reason='Historical retirement' from public.document_lifecycle where document_id=:'doc'),'retirement date and reason preserved in history');
select public.test_assert((select count(*)=1 from public.controlled_documents where code='TEST-DOC'),'replacement never duplicates identity');
select public.test_assert((select count(*)=12 from public.file_objects),'no original files deleted');
select public.test_denied(format('update public.controlled_document_versions set status=''current'' where id=%L',:'initial'),'USE_DOCUMENT_WORKFLOW','direct forged approval rejected');
select public.test_denied(format('select public.register_controlled_document_upload(''TEST-DOC'',''Original'',''P-TEST'',''manual'',''30000000-0000-4000-8000-000000000006'',''version'',''Wrong type'',%L,%L)',:'doc',:'recovered'),'DOCUMENT_SCOPE_MISMATCH','type mismatch rejected');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
select public.test_denied($q$select public.inspect_controlled_document_code('TEST-DOC','P-TEST','visual-aid')$q$,'FORBIDDEN','internal cannot replace');
select public.test_assert((select count(*)=0 from public.file_objects where id='30000000-0000-4000-8000-000000000001'),'old original is historical only');
select public.test_assert((select count(*)=1 from public.file_objects where id='30000000-0000-4000-8000-000000000005'),'internal can read current original');
select public.test_assert((select count(*)=0 from storage.objects where name like '%file-1.pdf'),'storage history request denied');
select public.test_assert((select count(*)=1 from storage.objects where name like '%file-5.pdf'),'current private storage request allowed');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000003';
select public.test_denied($q$select public.iq_document_admin_scope('P-TEST')$q$,'FORBIDDEN','customer cannot replace');
select public.test_assert((select count(*)=0 from public.file_objects where id='30000000-0000-4000-8000-000000000005'),'customer cannot read internal original');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000004';
select public.test_denied($q$select public.iq_document_admin_scope('P-TEST')$q$,'FORBIDDEN','supplier cannot replace');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000005';
select public.test_denied($q$select public.iq_document_admin_scope('P-TEST')$q$,'FORBIDDEN','other organization administrator rejected');
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000006';
select public.test_denied($q$select public.iq_document_admin_scope('P-TEST')$q$,'FORBIDDEN','inactive administrator rejected');
reset role;
-- Historical values are never reinterpreted or backfilled.
insert into public.controlled_documents(id,process_id,document_type_id,code,title,organization_id,owner_id,created_by)
 values('20000000-0000-4000-8000-000000000002','P-TEST','visual-aid','LEGACY','Legacy','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
insert into public.controlled_document_versions(id,document_id,revision,status,file_id,file_name,change_reason,uploaded_by)
 values('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',7,'current','30000000-0000-4000-8000-000000000010','Legacy.pdf','Historical','10000000-0000-4000-8000-000000000001');
set role authenticated;
set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.register_controlled_document_upload('LEGACY','Legacy','P-TEST','visual-aid','30000000-0000-4000-8000-000000000011','revision','Legacy correction','20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001');
select public.test_assert((select version_number is null and legacy_revision=7 and revision_sequence=1 from public.controlled_document_versions where document_id='20000000-0000-4000-8000-000000000002' and status='pending'),'legacy correction retains historical identifier without inventing version');
select public.test_assert((select revision=7 and version_number is null and replacement_kind is null from public.controlled_document_versions where id='40000000-0000-4000-8000-000000000001'),'historical numbering unchanged');
reset role;
