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
console.log(sql("-f", "supabase/tests/document-replacement-test.sql"));

const doc = sql("-Atc", "select id from public.controlled_documents where code='TEST-DOC'");
const base = sql("-Atc", `select id from public.controlled_document_versions where document_id='${doc}' order by revision desc limit 1`);
const register = (file, delay) => `begin; set local role authenticated; set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.register_controlled_document_upload('TEST-DOC','Original','P-TEST','visual-aid','${file}','version','Concurrent replacement','${doc}','${base}');
select pg_sleep(${delay}); commit;`;
function concurrent(query) {
  return new Promise(resolve => {
    const p = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c", query]);
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
