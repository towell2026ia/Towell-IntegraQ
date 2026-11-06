import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
assert.equal(process.env.CI, "true");
assert.equal(process.env.PGHOST, "127.0.0.1");
assert.equal(process.env.PGDATABASE, "supplier_audit_test");
assert.ok(!process.env.PGSERVICE && !process.env.PGSERVICEFILE);
function sql(...args) {
 const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
 if (result.status !== 0) throw new Error(result.stderr || result.stdout);
 console.log(result.stderr.split("\n").filter(line => line.includes("PASS:")).join("\n")); return result.stdout.trim();
}
sql("-f", "supabase/tests/rncp-matrix-fixture.sql");
sql("-f", "supabase/tests/rncp-legacy-trigger-fixture.sql");
for (const suffix of ["_rncp_matrix_followup.sql", "_rncp_requirements_batch_scope.sql"]) {
 const files = readdirSync("supabase/migrations").filter(n => n.endsWith(suffix)); assert.equal(files.length, 1); sql("-f", join("supabase/migrations", files[0]));
}
sql("-f", "supabase/tests/supplier-audit-legacy-fixture.sql");
// The shared trigger fixture already declares the assessment stub and its file trigger.
// Keep the versioned migration untouched; load all other original definitions into CI.
const legacySource = readFileSync("supabase/migrations/202610080006_supplier_assessment_results.sql", "utf8");
const tableDeclaration = /create table public\.supplier_assessments \([\s\S]*?\n\);/i;
const sharedFileTrigger = /create trigger file_objects_guard_supplier_assessment_scope\s+before insert or update on public\.file_objects\s+for each row execute function public\.guard_supplier_assessment_file_scope\(\);/i;
assert.match(legacySource, tableDeclaration); assert.match(legacySource, sharedFileTrigger);
sql("-c", legacySource.replace(tableDeclaration, "").replace(sharedFileTrigger, ""));
const proposals = readdirSync("supabase/migrations").filter(n => n.endsWith("_supplier_audit_calendar.sql")); assert.equal(proposals.length, 1);
sql("-f", join("supabase/migrations", proposals[0]));
sql("-f", "supabase/tests/supplier-audit-test.sql");
const id = sql("-At", "-c", "select id from public.supplier_audit_events where criteria='Concurrency target'");
assert.match(id, /^[a-f0-9-]{36}$/);
const command = `set role authenticated;select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000007',false);select public.iq_supplier_audit_save('${id}',1,'{"supplierId":"20000000-0000-4000-8000-000000000001","year":2040,"month":1,"precision":"month","state":"pending","criteria":"Concurrency target"}','Concurrent isolated test');`;
const results = await Promise.all([1, 2].map(() => new Promise(resolve => { let output = ""; const p = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c", command]); p.stdout.on("data", b => { output += b; }); p.stderr.on("data", b => { output += b; }); p.on("error", e => resolve({ code: -1, output: e.message })); p.on("close", code => resolve({ code, output })); })));
assert.equal(results.filter(r => r.code === 0).length, 1); assert.equal(results.filter(r => r.output.includes("AUDIT_CONFLICT")).length, 1);
console.log("PASS: concurrent inspectors cannot overwrite the same audit revision.");
console.log("PASS: supplier audit proposal tested only in an ephemeral synthetic CI database.");
