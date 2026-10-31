import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PROJECT, VERSION, validateSnapshot } from "./home-appearance.mjs";

// Supabase's shared session pooler is IPv4-only. Obtain its host from the
// project API rather than guessing the region or adding a new secret.
export async function sessionPoolerUrl(token, password, fetcher = fetch) {
  assert(token && password, "Missing protected runner credentials");
  const response = await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}/config/database/pooler`, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(response.ok, `Pooler discovery failed: HTTP ${response.status}`);
  const configs = await response.json();
  assert(Array.isArray(configs), "Unexpected pooler configuration");
  const hosts = [...new Set(configs.filter(c =>
    c.database_type === "PRIMARY" &&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(c.db_host) &&
    (!c.db_user || ["postgres", `postgres.${PROJECT}`].includes(c.db_user)) &&
    (!c.db_name || c.db_name === "postgres")
  ).map(c => c.db_host))];
  assert.equal(hosts.length, 1, "Expected one primary shared pooler for the approved project");
  const url = new URL(`postgresql://postgres.${PROJECT}@${hosts[0]}:5432/postgres`);
  url.password = password;
  url.searchParams.set("sslmode", "require");
  return url.toString();
}

export async function repairOverIpv4(env = process.env, fetcher = fetch, run = spawnSync) {
  assert.equal(env.EXPECTED_PROJECT_REF, PROJECT, "Runner target mismatch");
  assert(env.RUNNER_TEMP, "Missing protected runner workspace");
  const before = JSON.parse(await readFile(join(env.RUNNER_TEMP, "home-appearance-before.json"), "utf8"));
  validateSnapshot(before, "pre");
  const url = await sessionPoolerUrl(env.SUPABASE_ACCESS_TOKEN, env.SUPABASE_DB_PASSWORD, fetcher);
  const result = run("supabase", ["migration", "repair", VERSION, "--status", "applied", "--db-url", url, "--workdir", "approved-source"], {
    encoding: "utf8", stdio: "pipe", timeout: 120000,
    env: { ...env, SUPABASE_DB_PASSWORD: "" },
  });
  // The CLI can include its connection URL in errors. Never forward its output.
  assert(!result.error && result.status === 0, "Migration history repair failed; inspect read-only postflight");
  console.log(`CLI completed for migration ${VERSION} through the IPv4 session pooler; postflight still required`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  repairOverIpv4().catch(() => {
    console.error("FAIL: IPv4 history repair stopped. No credentials or connection details are printed.");
    process.exitCode = 1;
  });
}
