import assert from "node:assert/strict";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

export const PROJECT = "yptrqowmviixlkrxjrqr";
export const VERSION = "202610290001";
export const NAME = "home_appearance_admin_scope";
const PREFIX = "workspace_data_home_appearance_";
const condition = "area<>'homeAppearance'ORis_administrator()";
export const SNAPSHOT_SQL = `select jsonb_build_object(
  'policies', (select coalesce(jsonb_agg(to_jsonb(p) order by policyname),'[]'::jsonb) from pg_policies p where schemaname='public' and tablename='workspace_data'),
  'dependencies', (select coalesce(jsonb_agg(jsonb_build_object('policy',p.polname,'schema',n.nspname,'function',f.proname) order by p.polname,n.nspname,f.proname),'[]'::jsonb) from pg_policy p join pg_depend d on d.classid='pg_policy'::regclass and d.objid=p.oid and d.refclassid='pg_proc'::regclass join pg_proc f on f.oid=d.refobjid join pg_namespace n on n.oid=f.pronamespace where p.polrelid='public.workspace_data'::regclass and p.polname in ('workspace_data_home_appearance_insert','workspace_data_home_appearance_update','workspace_data_home_appearance_delete')),
  'history', (select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name)),'[]'::jsonb) from supabase_migrations.schema_migrations where version='202610290001'),
  'otherHistoryFingerprint', (select md5(coalesce(jsonb_agg(to_jsonb(m) order by version)::text,'[]')) from supabase_migrations.schema_migrations m where version <> '202610290001')
) as snapshot;`;
function normalize(value) {
  return value == null ? null : value.replace(/::text/g, "").replace(/public\./g, "").replace(/[\s()]/g, "");
}
export function validatePolicies(snapshot) {
  assert(Array.isArray(snapshot.policies), "Missing policy snapshot");
  const target = snapshot.policies.filter(p => p.policyname.startsWith(PREFIX));
  assert.equal(target.length, 3, "Expected exactly three named policies");
  for (const [suffix, using, check] of [["insert",null,condition],["update",condition,condition],["delete",condition,null]]) {
    const policy = target.find(p => p.policyname === PREFIX + suffix);
    assert(policy, `Missing ${suffix} policy`);
    assert.equal(policy.schemaname, "public"); assert.equal(policy.tablename, "workspace_data");
    assert.equal(policy.permissive, "RESTRICTIVE"); assert.equal(policy.cmd, suffix.toUpperCase());
    assert.deepEqual(policy.roles, ["authenticated"]);
    assert.equal(normalize(policy.qual), using?.replace(/[()]/g, "") ?? null);
    assert.equal(normalize(policy.with_check), check?.replace(/[()]/g, "") ?? null);
    const dependencies = snapshot.dependencies.filter(d => d.policy === policy.policyname);
    assert.equal(dependencies.length, suffix === "update" ? 2 : 1);
    assert(dependencies.every(d => d.schema === "public" && d.function === "is_administrator"), "Unexpected function dependency");
  }
}
export function validateSnapshot(snapshot, phase, before) {
  validatePolicies(snapshot);
  assert.match(snapshot.otherHistoryFingerprint, /^[0-9a-f]{32}$/);
  assert(Array.isArray(snapshot.history));
  if (phase === "pre") assert.equal(snapshot.history.length, 0, "Version already registered: STOP without repair");
  else {
    assert.equal(phase, "post"); assert(before, "Missing preflight baseline");
    assert.deepEqual(snapshot.history, [{ version: VERSION, name: NAME }], "Expected exactly one matching history entry");
    assert.deepEqual(snapshot.policies, before.policies, "Workspace policies changed: manual investigation required");
    assert.deepEqual(snapshot.dependencies, before.dependencies, "Policy dependencies changed");
    assert.equal(snapshot.otherHistoryFingerprint, before.otherHistoryFingerprint, "Other migration history changed");
  }
}
export async function collectSnapshot(token, fetcher = fetch) {
  assert(token, "Missing Supabase access token");
  async function request(suffix, body) {
    const response = await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}${suffix}`, {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Never print response bodies, headers or credentials on an API failure.
    assert(response.ok, `Supabase read-only verification failed: HTTP ${response.status}`);
    return response.json();
  }
  const project = await request("");
  assert.equal(project.id, PROJECT, "Wrong project: STOP");
  assert.equal(project.status, "ACTIVE_HEALTHY", "Project is not healthy: STOP");
  const rows = await request("/database/query", { query: SNAPSHOT_SQL, read_only: true });
  assert(Array.isArray(rows) && rows.length === 1 && rows[0].snapshot, "Invalid read-only query response");
  return rows[0].snapshot;
}
export async function main(phase, filename) {
  assert(["pre","post"].includes(phase) && filename, "Use pre|post and a baseline path");
  assert.equal(process.env.EXPECTED_PROJECT_REF, PROJECT, "Runner target mismatch");
  const before = phase === "post" ? JSON.parse(await readFile(filename, "utf8")) : undefined;
  const snapshot = await collectSnapshot(process.env.SUPABASE_ACCESS_TOKEN);
  validateSnapshot(snapshot, phase, before);
  if (phase === "pre") await writeFile(filename, JSON.stringify(snapshot), { mode: 0o600, flag: "wx" });
  const fingerprint = createHash("sha256").update(JSON.stringify(snapshot.policies)).digest("hex");
  const evidence = `PASS ${phase}: project=${PROJECT}; version=${VERSION}; history_count=${snapshot.history.length}; policy_sha256=${fingerprint}; other_history_md5=${snapshot.otherHistoryFingerprint}`;
  console.log(evidence);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, evidence + "\n\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2], process.argv[3]).catch(() => {
    console.error("FAIL: verification stopped. No automatic repair retry or rollback. Review the last successful preflight/postflight evidence.");
    process.exitCode = 1;
  });
}