import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { assertRecoveryEnvironment, loadBackup, recoveryEnv, writeEvidence } from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
if (!env.SUPABASE_SECRET_KEY) throw new Error("Falta SUPABASE_SECRET_KEY local.");
const backup = await loadBackup(env);
const expectedUsers = JSON.parse(await readFile(join(backup.root, "auth-users.json"), "utf8"));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const actualUsers = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  actualUsers.push(...data.users);
  if (data.users.length < 1000) break;
}
const expectedIds = new Set(expectedUsers.map((user) => user.id));
const actualIds = new Set(actualUsers.map((user) => user.id));
const missingIds = [...expectedIds].filter((id) => !actualIds.has(id));
const unexpectedIds = [...actualIds].filter((id) => !expectedIds.has(id));
const { count: profiles, error: profilesError } = await supabase.from("profiles").select("*", { count: "exact", head: true });
const evidence = {
  result: actualUsers.length === expectedUsers.length && missingIds.length === 0 && unexpectedIds.length === 0 && !profilesError && profiles === expectedUsers.length ? "PASS" : "FAIL",
  expectedUsers: expectedUsers.length,
  actualUsers: actualUsers.length,
  profiles,
  missingIds,
  unexpectedIds,
  passwords: "RECOVERY_ONLY_NOT_PRODUCTION",
};
await writeEvidence("auth-validation", evidence);
console.log(JSON.stringify(evidence, null, 2));
if (evidence.result !== "PASS") process.exitCode = 1;
