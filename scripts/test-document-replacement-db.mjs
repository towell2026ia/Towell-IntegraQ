import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

// Never accept a Supabase URL or any remote database; this fixture is CI only.
assert.equal(process.env.CI, "true");
assert.equal(process.env.PGHOST, "127.0.0.1");
assert.equal(process.env.PGDATABASE, "document_replacement_test");
assert.ok(!process.env.PGSERVICE && !process.env.PGSERVICEFILE);
function sql(...args) {
  const r = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  if (r.stderr.includes("PASS:")) console.log(r.stderr.trim());
  return r.stdout.trim();
}
sql("-f", "supabase/tests/document-replacement-fixture.sql");
const migrations = readdirSync("supabase/migrations").filter(name => name.endsWith("_controlled_document_replacement.sql"));
assert.equal(migrations.length, 1);
sql("-f", join("supabase/migrations", migrations[0]));
// Reproduce the exact authenticated INSERT RETURNING failure before the repair.
sql("-c", `set role authenticated;set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.test_denied($q$insert into public.file_objects(id,bucket_id,object_path,original_name,size_bytes,uploaded_by,resource_type,module_id,audience,process_id,category)
values('30000000-0000-4000-8000-999999999999','integraq-private','synthetic-returning.pdf','Synthetic.pdf',100,auth.uid(),'controlled_document','documents','internal','P-TEST','visual-aid') returning id$q$,
'iq_document_replacement_file_read','baseline reproduces exact INSERT RETURNING RLS error');`);
const repairs = readdirSync("supabase/migrations").filter(name => name.endsWith("_controlled_document_upload_registration.sql")); assert.equal(repairs.length, 1);
sql("-f", join("supabase/migrations", repairs[0]));
console.log(sql("-f", "supabase/tests/document-replacement-test.sql"));
console.log(sql("-f", "supabase/tests/document-upload-registration-test.sql"));

const doc = sql("-Atc", "select id from public.controlled_documents where code='TEST-DOC'");
const base = sql("-Atc", `select id from public.controlled_document_versions where document_id='${doc}' order by revision desc limit 1`);
const register = (file, delay) => `begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.register_controlled_document_upload('TEST-DOC','Original','P-TEST','visual-aid','${file}','version','Concurrent replacement','${doc}','${base}');
select pg_sleep(${delay}); commit;`;
function concurrent(query) {
  return new Promise(resolve => {
    const p = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", query]);
    let out = ""; p.stdout.on("data", x => out += x); p.stderr.on("data", x => out += x);
    p.on("close", status => resolve({ status, out }));
  });
}
const outcomes = await Promise.all([
  concurrent(register("30000000-0000-4000-8000-000000000008", 1)),
  concurrent(register("30000000-0000-4000-8000-000000000009", 1)),
]);
assert.equal(outcomes.filter(r => r.status === 0).length, 1, JSON.stringify(outcomes));
assert.ok(outcomes.some(r => r.out.includes("DOCUMENT_CHANGED")), JSON.stringify(outcomes));
assert.equal(sql("-Atc", `select count(*) from public.controlled_document_versions where document_id='${doc}' and status='current'`), "1");
assert.equal(sql("-Atc", `select count(*) from public.controlled_document_versions where document_id='${doc}' and status='pending'`), "1");
console.log("PASS: concurrent upload serialized; one pending candidate, one authorized current.");

// Exercise the new reservation/receipt protocol from separate authenticated
// transactions, not just the legacy registration path above.
const modifier = "set local role authenticated;set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000007';";
const payload = "public.test_upload_payload('CONCURRENT-RESERVED')";
const reserve = `begin;${modifier}select public.test_reserve(${payload})->>'fileId';select pg_sleep(0.2);commit;`;
const reservations = await Promise.all([concurrent(reserve), concurrent(reserve)]);
assert.ok(reservations.every(r => r.status === 0), JSON.stringify(reservations));
const reservationIds = reservations.map(r => r.out.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0]);
assert.ok(reservationIds[0], JSON.stringify(reservations));
assert.equal(reservationIds[0], reservationIds[1]);
const fileId = reservationIds[0];
assert.equal(sql("-Atc", `select count(*) from public.file_objects where id='${fileId}' and validity_status='upload_pending'`), "1");
sql("-c", `begin;${modifier}insert into storage.objects(bucket_id,name,owner_id,metadata)
 select bucket_id,object_path,auth.uid()::text,'{"size":100}'::jsonb from public.file_objects where id='${fileId}';commit;`);
console.log("PASS: concurrent identical captures reuse one tracked reservation and one private object.");
const commit = `begin;${modifier}select public.test_commit(${payload},jsonb_build_object('fileId','${fileId}'));select pg_sleep(0.2);commit;`;
const receipts = await Promise.all([concurrent(commit), concurrent(commit)]);
assert.ok(receipts.every(r => r.status === 0), JSON.stringify(receipts));
const documentIds = receipts.map(r => r.out.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0]);
assert.ok(documentIds[0], JSON.stringify(receipts));
assert.equal(documentIds[0], documentIds[1]);
assert.equal(sql("-Atc", "select count(*) from public.controlled_documents where code='CONCURRENT-RESERVED'"), "1");
assert.equal(sql("-Atc", `select count(*) from public.controlled_document_versions where document_id='${documentIds[0]}' and status='pending' and file_id='${fileId}'`), "1");
assert.equal(sql("-Atc", `select count(*) from public.document_workflow_events where document_id='${documentIds[0]}'`), "2");
assert.equal(sql("-Atc", `select count(*) from public.document_audit_log where document_id='${documentIds[0]}'`), "1");
console.log("PASS: concurrent final retries return one receipt without duplicate document, version or audit events.");
