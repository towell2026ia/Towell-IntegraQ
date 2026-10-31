import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROJECT, VERSION, NAME, collectSnapshot, validateSnapshot, SNAPSHOT_SQL } from "./home-appearance.mjs";
import { sessionPoolerUrl, repairOverIpv4, diagnosticLine, classifyCliFailure, RepairDiagnosticError } from "./home-appearance-ipv4.mjs";
const expr = "((area <> 'homeAppearance'::text) OR is_administrator())";
function baseline() {
  return {
    policies: ["delete","insert","update"].map(suffix => ({ schemaname: "public", tablename: "workspace_data", policyname: "workspace_data_home_appearance_" + suffix, permissive: "RESTRICTIVE", roles: ["authenticated"], cmd: suffix.toUpperCase(), qual: suffix === "insert" ? null : expr, with_check: suffix === "delete" ? null : expr })),
    dependencies: ["delete","insert","update","update"].map(suffix => ({ policy: "workspace_data_home_appearance_" + suffix, schema: "public", function: "is_administrator" })),
    history: [], otherHistoryFingerprint: "a".repeat(32),
  };
}
test("preflight accepts only the expected absent version and policy definitions", () => { validateSnapshot(baseline(), "pre"); });
test("already applied version aborts instead of replaying repair", () => { const row = baseline(); row.history = [{ version: VERSION, name: NAME }]; assert.throws(() => validateSnapshot(row,"pre")); });
for (const [name, mutate] of [
  ["permissive policy", row => row.policies[0].permissive = "PERMISSIVE"],
  ["wrong role", row => row.policies[0].roles = ["public"]],
  ["missing update check", row => row.policies[2].with_check = null],
  ["broadened condition", row => row.policies[2].qual = "true"],
  ["wrong function schema", row => row.dependencies[0].schema = "other"],
  ["missing policy", row => row.policies.pop()],
]) test(`rejects ${name}`, () => { const row = baseline(); mutate(row); assert.throws(() => validateSnapshot(row,"pre")); });
test("postflight requires one matching history record with every policy intact", () => {
  const before = baseline(); const after = structuredClone(before); after.history = [{ version: VERSION, name: NAME }]; validateSnapshot(after,"post",before);
  after.history.push({ version: VERSION, name: NAME }); assert.throws(() => validateSnapshot(after,"post",before));
});
test("postflight detects changes to unrelated policies and migration history", () => {
  const before = baseline(); const after = structuredClone(before); after.history = [{ version: VERSION, name: NAME }];
  after.policies.push({ policyname: "unrelated" }); assert.throws(() => validateSnapshot(after,"post",before));
  after.policies.pop(); after.otherHistoryFingerprint = "b".repeat(32); assert.throws(() => validateSnapshot(after,"post",before));
});
test("wrong project stops before any query", async () => {
  let calls = 0;
  await assert.rejects(collectSnapshot("TEST_ONLY", async () => { calls++; return { ok: true, json: async () => ({ id: "wrong", status: "ACTIVE_HEALTHY" }) }; }));
  assert.equal(calls,1);
});
test("cloud verification submits only the constant read-only query to the fixed project", async () => {
  const calls=[]; const row=baseline();
  const result=await collectSnapshot("TEST_ONLY", async (url, options) => { calls.push({url,options}); return { ok: true, json: async () => calls.length === 1 ? { id: PROJECT, status: "ACTIVE_HEALTHY" } : [{ snapshot: row }] }; });
  assert.deepEqual(result,row); assert.equal(calls[1].url,`https://api.supabase.com/v1/projects/${PROJECT}/database/query`);
  assert.deepEqual(JSON.parse(calls[1].options.body), { query: SNAPSHOT_SQL, read_only: true });
  assert.equal(calls[1].options.redirect,"error");
});
test("workflow is manual-only, gated, and has one fixed repair operation", () => {
  const workflow=readFileSync(new URL("../../.github/workflows/reconcile-home-appearance-history.yml",import.meta.url),"utf8");
  assert.match(workflow,/on:\s*\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow,/^\s+(push|pull_request|schedule|workflow_run):/m);
  assert.match(workflow,/environment: supabase-history-repair/);
  assert.match(workflow,/SUPABASE_REPAIR_APPROVED_VERSION/);
  assert.match(workflow,/contents: read/);
  assert.match(workflow,/node scripts\/migration-history\/home-appearance-ipv4\.mjs/);
  const ipv4=readFileSync(new URL("./home-appearance-ipv4.mjs",import.meta.url),"utf8");
  assert.equal((ipv4.match(/"migration", "repair"/g)||[]).length,1);
  assert.match(ipv4,/"--status", "applied", "--db-url"/);
  assert.match(ipv4,/"--workdir", "approved-source"/);
  assert.doesNotMatch(workflow,/supabase (db (push|reset)|migration (up|down))|--status reverted|service_role/);
});

test("IPv4 pooler URL comes only from official primary shared pooler metadata", async () => {
  const calls=[];
  const url=await sessionPoolerUrl("TEST_TOKEN", "test:#? password", async (endpoint, options) => {
    calls.push({endpoint,options});
    return { ok:true, json:async()=>[{ database_type:"PRIMARY", db_host:"aws-0-us-east-1.pooler.supabase.com", db_user:"postgres", db_name:"postgres", pool_mode:"transaction" }] };
  });
  assert.equal(calls[0].endpoint,`https://api.supabase.com/v1/projects/${PROJECT}/config/database/pooler`);
  assert.equal(calls[0].options.method,"GET");
  const parsed=new URL(url);
  assert.equal(parsed.hostname,"aws-0-us-east-1.pooler.supabase.com");
  assert.equal(parsed.port,"5432");
  assert.equal(parsed.username,`postgres.${PROJECT}`);
  assert.equal(parsed.password,"test%3A%23%3F%20password");
  assert.equal(parsed.searchParams.get("sslmode"),"require");
});

for (const [label, configs] of [
  ["direct IPv6 host",[{database_type:"PRIMARY",db_host:`db.${PROJECT}.supabase.co`}]],
  ["unknown pooler host",[{database_type:"PRIMARY",db_host:"other.example.com"}]],
  ["nonprimary database",[{database_type:"READ_REPLICA",db_host:"aws-0-us-east-1.pooler.supabase.com"}]],
  ["ambiguous pooler hosts",[{database_type:"PRIMARY",db_host:"aws-0-us-east-1.pooler.supabase.com"},{database_type:"PRIMARY",db_host:"aws-1-us-east-1.pooler.supabase.com"}]],
]) test(`IPv4 discovery rejects ${label}`, async () => {
  await assert.rejects(sessionPoolerUrl("TEST_TOKEN","TEST_PASSWORD",async()=>({ok:true,json:async()=>configs})));
});

test("repair wrapper invokes only the approved version over the IPv4 URL after a valid baseline", async () => {
  const folder=await mkdtemp(join(tmpdir(),"integraq-ipv4-test-"));
  try {
    await writeFile(join(folder,"home-appearance-before.json"),JSON.stringify(baseline()));
    let called=0;
    await repairOverIpv4({EXPECTED_PROJECT_REF:PROJECT,RUNNER_TEMP:folder,SUPABASE_ACCESS_TOKEN:"TEST_TOKEN",SUPABASE_DB_PASSWORD:"TEST_PASSWORD"},
      async()=>({ok:true,json:async()=>[{database_type:"PRIMARY",db_host:"aws-0-us-east-1.pooler.supabase.com"}]}),
      (command,args,options)=>{
        called++;
        assert.equal(command,"supabase");
        assert.deepEqual(args.slice(0,6),["migration","repair",VERSION,"--status","applied","--db-url"]);
        assert.match(args[6],/pooler\.supabase\.com:5432\/postgres\?sslmode=require$/);
        assert.deepEqual(args.slice(7),["--workdir","approved-source"]);
        assert.equal(options.env.SUPABASE_DB_PASSWORD,"");
        return {status:0};
      });
    assert.equal(called,1);
  } finally { await unlink(join(folder,"home-appearance-before.json")); await rmdir(folder); }
});

test("pooler discovery reports only stage and HTTP status", async () => {
  const injected="SECRET_TOKEN_AND_URL";
  await assert.rejects(sessionPoolerUrl(injected,"SECRET_PASSWORD",async()=>({ok:false,status:403})),error=>{
    assert.equal(diagnosticLine(error),"FAIL: stage=pooler_discovery; code=HTTP_ERROR; http_status=403");
    assert(!diagnosticLine(error).includes(injected));
    return true;
  });
  await assert.rejects(sessionPoolerUrl(injected,"SECRET_PASSWORD",async()=>{throw new Error(injected);}),error=>{
    assert.equal(diagnosticLine(error),"FAIL: stage=pooler_discovery; code=REQUEST_FAILED");
    return true;
  });
});

test("connection validation distinguishes missing and ambiguous poolers without printing hosts", async () => {
  for (const [configs,code] of [
    [[{database_type:"PRIMARY",db_host:"db.project.supabase.co"}],"NO_PRIMARY_SHARED_POOLER"],
    [[{database_type:"PRIMARY",db_host:"aws-0-us-east-1.pooler.supabase.com"},{database_type:"PRIMARY",db_host:"aws-1-us-east-1.pooler.supabase.com"}],"AMBIGUOUS_POOLER"],
  ]) await assert.rejects(sessionPoolerUrl("TOKEN","PASSWORD",async()=>({ok:true,json:async()=>configs})),error=>{
    assert.equal(diagnosticLine(error),`FAIL: stage=connection_validation; code=${code}`);
    assert(!diagnosticLine(error).includes("pooler.supabase.com"));
    return true;
  });
});

test("CLI failure classifier emits only established categories", () => {
  assert.equal(classifyCliFailure("password authentication failed for user postgres"),"AUTHENTICATION_FAILED");
  assert.equal(classifyCliFailure("IPv6 is not supported on your current network"),"IPV6_UNSUPPORTED");
  assert.equal(classifyCliFailure("unrecognized private detail"),"EXIT_NONZERO_UNCLASSIFIED");
  assert.equal(diagnosticLine(new Error("SECRET_URL")),"FAIL: stage=unknown; code=UNCLASSIFIED");
  assert.equal(diagnosticLine(new RepairDiagnosticError("repair_result","EXIT_NONZERO_UNCLASSIFIED",{exitCode:1})),"FAIL: stage=repair_result; code=EXIT_NONZERO_UNCLASSIFIED; cli_exit=1");
});

test("CLI invocation and repair result report sanitized stage and exit code", async () => {
  const folder=await mkdtemp(join(tmpdir(),"integraq-ipv4-diagnostic-"));
  try {
    await writeFile(join(folder,"home-appearance-before.json"),JSON.stringify(baseline()));
    const env={EXPECTED_PROJECT_REF:PROJECT,RUNNER_TEMP:folder,SUPABASE_ACCESS_TOKEN:"SECRET_TOKEN",SUPABASE_DB_PASSWORD:"SECRET_PASSWORD"};
    const fetcher=async()=>({ok:true,json:async()=>[{database_type:"PRIMARY",db_host:"aws-0-us-east-1.pooler.supabase.com"}]});
    await assert.rejects(repairOverIpv4(env,fetcher,()=>({error:{code:"ENOENT"}})),error=>{
      assert.equal(diagnosticLine(error),"FAIL: stage=cli_invocation; code=ENOENT");
      return true;
    });
    await assert.rejects(repairOverIpv4(env,fetcher,()=>({status:1,stderr:"password authentication failed; SECRET_PASSWORD postgresql://SECRET_URL"})),error=>{
      const line=diagnosticLine(error);
      assert.equal(line,"FAIL: stage=repair_result; code=AUTHENTICATION_FAILED; cli_exit=1");
      assert(!line.includes("SECRET_PASSWORD") && !line.includes("SECRET_URL"));
      return true;
    });
  } finally { await unlink(join(folder,"home-appearance-before.json")); await rmdir(folder); }
});
