import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';

// Run from the checkout. NODE_PATH may reference the existing isolated QA runtime.
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
(async () => {
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
create table organizations(id uuid primary key,kind text,active boolean,owning_organization_id uuid);
create table profiles(id uuid primary key,status text,user_type text,organization_id uuid);
create table file_objects(id uuid primary key default gen_random_uuid(),bucket_id text,object_path text,original_name text,mime_type text,size_bytes bigint,sha256 text,workspace_id uuid,external_organization_id uuid,audience text,resource_type text,resource_id uuid,uploaded_by uuid,display_name text);
create table document_folders(workspace_id uuid);
create table certifications(id uuid primary key,customer_visible boolean,external_organization_id uuid,workspace_id uuid,published_at timestamptz,published_by uuid);
create table storage.objects(bucket_id text,name text);
alter table file_objects enable row level security;
alter table document_folders enable row level security;
alter table storage.objects enable row level security;
create policy fixture_baseline on file_objects for select to authenticated using(true);
create policy fixture_baseline on storage.objects for select to authenticated using(true);
grant usage on schema storage,auth to authenticated;
grant select on file_objects,profiles,storage.objects to authenticated;`);
await db.exec(`alter table profiles add column workspace_mode text default 'production';
alter table certifications add column revision int default 1, add column active boolean default true,
 add column name text, add column issuer text, add column scope text, add column valid_from date,
 add column valid_until date, add column certification_type text, add column reference_number text,
 add column observations text, add column responsible_id uuid, add column updated_by uuid;
alter table file_objects add column is_current boolean default true, add column deleted_at timestamptz;
create table audit_log(actor_id uuid,organization_id uuid,module text,action text,resource_type text,
 resource_id uuid,previous_value jsonb,new_value jsonb,reason text,metadata jsonb);
grant select, update on certifications, profiles, organizations to service_role;
grant select on file_objects to service_role;
grant select,insert on audit_log to service_role;`);
const historical = fs.readFileSync("supabase/migrations/20261105201826_customer_certifications.sql","utf8");
await db.exec(historical.slice(historical.indexOf("create function public.iq_certification_command")));
await assert.rejects(db.query("select iq_u01_publication_ready_v2()"), /does not exist/);
await db.exec(fs.readFileSync("docs/database/proposals/IQ-CUSTOMER-PORTAL-INDIVIDUAL-PUBLICATIONS.sql","utf8"));
const [workspace,customer,actor,internal,external] = ['1','2','3','4','5'].map(x=>x.repeat(8)+'-aaaa-4aaa-8aaa-'+x.repeat(12));
await db.query("insert into organizations values ($1,'internal',true,null),($2,'customer',true,$1)",[workspace,customer]);
await db.query("insert into profiles values ($1,'active','administrator',$2),($3,'active','internal',$2),($4,'active','customer',$5)",[actor,workspace,internal,external,customer]);
await db.query("insert into file_objects(workspace_id,resource_type) values ($1,'general_information_document')",[workspace]);
const internalKey=workspace+'/information-general/folder/original.pdf';
const key='customer-portal/'+workspace+'/'+customer+'/'+actor+'.pdf';
await db.query("insert into storage.objects values ('integraq-private',$1),('integraq-private',$2)",[internalKey,key]);
const cert = 'cccccccc-aaaa-4aaa-8aaa-cccccccccccc';
await db.query("insert into certifications(id,workspace_id,customer_visible) values($1,$2,false)",[cert,workspace]);
await db.query("insert into file_objects(resource_id,workspace_id,resource_type,object_path) values($1,$2,'customer_certification_document','original.pdf')",[cert,workspace]);
const originals=async()=>(await db.query('select * from file_objects where resource_id=$1',[cert])).rows;
const before=await originals();
const payload={id:cert,customerId:customer,revision:1,name:'Fixture',type:'Sistema',issuer:'Fixture',responsibleId:actor,validFrom:'2000-01-01',validUntil:'2099-12-31'};
await db.exec('set role service_role');
assert.equal((await db.query('select iq_u01_publication_ready_v2() as ok')).rows[0].ok,true);
const assign = (who,body) => db.query('select iq_u01_save_certification_recipient($1,$2,$3::jsonb) as result',[who,workspace,JSON.stringify(body)]);
await assert.rejects(assign(internal,payload),/ADMIN_REQUIRED/);
await assert.rejects(assign(actor,{...payload,customerId:workspace}),/CUSTOMER_SCOPE_DENIED/);
const saved=(await assign(actor,payload)).rows[0].result.certification;
assert.equal(saved.external_organization_id,customer);
assert.equal(saved.revision,2);
assert.equal(saved.customer_visible,false);
await assert.rejects(assign(actor,payload),/CONCURRENT_EDIT/);
await assert.rejects(assign(actor,{...payload,revision:2}),/IMMUTABLE/);
const cmd=(command,revision)=>db.query("select iq_certification_command($1,$2,$3,$4::jsonb) as result",[actor,workspace,command,JSON.stringify({id:cert,revision})]);
assert.equal((await cmd('publish',2)).rows[0].result.certification.customer_visible,true);
assert.equal((await cmd('unpublish',3)).rows[0].result.certification.customer_visible,false);
assert.deepEqual(await originals(),before);
assert.equal((await db.query("select count(*)::int n from audit_log where action='certification.recipient_assigned'")).rows[0].n,1);
const pub=(await db.query("select public.iq_customer_portal_document_record($1,$2,$3,$4,'manual.pdf','Manual',null,12,$5,'application/pdf',null) as row",[actor,workspace,customer,key,'a'.repeat(64)])).rows[0].row;
assert.equal(pub.status,'draft');assert.equal(pub.customer_id,customer);
assert.equal((await db.query("select count(*)::int as n from customer_portal_document_publications where status='published'")).rows[0].n,0);
const trans=async(command,revision,reason)=>(await db.query("select iq_customer_portal_document_transition($1,$2,$3,$4,$5,$6) as row",[actor,workspace,pub.id,command,reason,revision])).rows[0].row;
const published=await trans('publish',1,null);
assert.equal((await db.query("select count(*)::int n from customer_portal_document_publications where customer_id=$1 and status='published'",[customer])).rows[0].n,1); assert.equal(published.status,'published');
await assert.rejects(trans('withdraw',1,'retirar'),/REVISION_CONFLICT/);
const withdrawn=await trans('withdraw',2,'retiro de prueba'); assert.equal(withdrawn.status,'withdrawn'); assert.equal(withdrawn.file_id,pub.file_id);
assert.equal((await db.query("select count(*)::int n from customer_portal_document_publications where status='published'")).rows[0].n,0);
assert.deepEqual((await db.query("select action from customer_portal_document_events order by id")).rows.map(r=>r.action),['draft_created','published','withdrawn']);
await db.exec('reset role');
assert.equal((await db.query('select count(*)::int n from file_objects where id=$1',[pub.file_id])).rows[0].n,1);
await assert.rejects(db.query("insert into certifications values($1,true,null,$2,now(),$3)",[actor,workspace,actor]),/RECIPIENT_REQUIRED/);
await db.exec('set role authenticated');
for (const [id,count] of [[internal,1],[external,0]]) {
 await db.query("select set_config('test.user_id',$1,false)",[id]);
 assert.equal((await db.query("select count(*)::int n from file_objects where resource_type='general_information_document'")).rows[0].n,count);
 assert.equal((await db.query("select count(*)::int n from storage.objects where name=$1",[internalKey])).rows[0].n,count);
 assert.equal((await db.query("select count(*)::int n from storage.objects where name=$1",[key])).rows[0].n,0);
 await assert.rejects(db.query('select * from customer_portal_document_publications'),/permission denied/i);
}
await db.close(); console.log('PASS U01-TRANS-02/04/05 SQL in-memory: proposal installed; draft, publish, revision conflict, withdraw, audit order, retained original, certificate guard, storage and metadata RLS');
})().catch(e=>{console.error(e.message);process.exitCode=1});
