import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { assertRecoveryEnvironment, loadBackup, recoveryEnv, writeEvidence } from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
if (!env.SUPABASE_SECRET_KEY) throw new Error("Falta SUPABASE_SECRET_KEY local.");
if (!env.RECOVERY_DEFAULT_PASSWORD || env.RECOVERY_DEFAULT_PASSWORD.length < 12) {
  throw new Error("RECOVERY_DEFAULT_PASSWORD debe existir y tener al menos 12 caracteres; no se versiona.");
}

const backup = await loadBackup(env);
const users = JSON.parse(await readFile(join(backup.root, "auth-users.json"), "utf8"));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const existing = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  existing.push(...data.users);
  if (data.users.length < 1000) break;
}
const existingIds = new Set(existing.map((user) => user.id));
let created = 0;
let updated = 0;
for (const user of users) {
  const attributes = {
    id: user.id,
    email: user.email,
    phone: user.phone || undefined,
    password: env.RECOVERY_DEFAULT_PASSWORD,
    email_confirm: true,
    phone_confirm: Boolean(user.phone),
    user_metadata: user.user_metadata ?? {},
    app_metadata: user.app_metadata ?? {},
    role: user.role ?? "authenticated",
  };
  const response = existingIds.has(user.id)
    ? await supabase.auth.admin.updateUserById(user.id, attributes)
    : await supabase.auth.admin.createUser(attributes);
  if (response.error) throw new Error(`Auth ${user.id}: ${response.error.message}`);
  if (existingIds.has(user.id)) updated += 1;
  else created += 1;
}

const evidence = { result: "PASS", expected: users.length, created, updated, passwordSource: "RECOVERY_DEFAULT_PASSWORD" };
await writeEvidence("auth", evidence);
console.log(JSON.stringify(evidence, null, 2));
