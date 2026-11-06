import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

assert.equal(process.env.CI, "true");
assert.equal(process.env.PGHOST, "127.0.0.1");
assert.equal(process.env.PGDATABASE, "rncp_matrix_test");
assert.ok(!process.env.PGSERVICE && !process.env.PGSERVICEFILE);
function sql(...args) {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  console.log(result.stderr.split("\n").filter(line => line.includes("PASS:")).join("\n"));
  return result.stdout.trim();
}
sql("-f", "supabase/tests/rncp-matrix-fixture.sql");
sql("-f", "supabase/tests/rncp-legacy-trigger-fixture.sql");
const migrations = readdirSync("supabase/migrations").filter(name => name.endsWith("_rncp_matrix_followup.sql"));
assert.equal(migrations.length, 1);
sql("-f", join("supabase/migrations", migrations[0]));
sql("-f", "supabase/tests/rncp-matrix-test.sql");
console.log("PASS: RNCP proposal executed only against ephemeral synthetic CI database.");
