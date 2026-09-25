import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { assertRecoveryEnvironment, loadBackup, recoveryEnv, writeEvidence } from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !env.RECOVERY_DEFAULT_PASSWORD) {
  throw new Error("Faltan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY o RECOVERY_DEFAULT_PASSWORD locales.");
}
const backup = await loadBackup(env);
const users = JSON.parse(await readFile(join(backup.root, "auth-users.json"), "utf8"));
const productionAdmin = users.find((user) => user.email && user.app_metadata?.user_type === "administrator" && user.app_metadata?.workspace_mode !== "demo");
const demoAdmin = users.find((user) => user.email && user.app_metadata?.user_type === "administrator" && user.app_metadata?.workspace_mode === "demo");
const restrictedUser = users.find((user) => user.email && ["customer", "supplier"].includes(user.app_metadata?.user_type));
if (!productionAdmin || !demoAdmin || !restrictedUser) throw new Error("El backup no contiene las tres identidades requeridas para RLS/Signed URL.");

function client() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
async function signIn(user) {
  const supabase = client();
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: env.RECOVERY_DEFAULT_PASSWORD });
  if (error) throw new Error(`Login Recovery ${user.id}: ${error.message}`);
  return supabase;
}

const production = await signIn(productionAdmin);
const demo = await signIn(demoAdmin);
const restricted = await signIn(restrictedUser);
const { data: profile, error: profileError } = await production.from("profiles").select("organization_id").eq("id", productionAdmin.id).single();
if (profileError || !profile.organization_id) throw new Error(`Perfil Recovery sin workspace: ${profileError?.message ?? productionAdmin.id}`);
const area = `recoveryProbe${Date.now()}`;
const base = { workspace_id: profile.organization_id, area };

const createProduction = await production.from("workspace_data").insert({ ...base, workspace_mode: "production", payload: { stage: "CREATE" }, created_by: productionAdmin.id, updated_by: productionAdmin.id }).select().single();
if (createProduction.error) throw createProduction.error;
const createDemo = await demo.from("workspace_data").insert({ ...base, workspace_mode: "demo", payload: { stage: "CREATE" }, created_by: demoAdmin.id, updated_by: demoAdmin.id }).select().single();
if (createDemo.error) throw createDemo.error;
const productionView = await production.from("workspace_data").select("id,workspace_mode").eq("area", area);
const demoView = await demo.from("workspace_data").select("id,workspace_mode").eq("area", area);
const isolation = !productionView.error && !demoView.error
  && productionView.data.length === 1 && productionView.data[0].workspace_mode === "production"
  && demoView.data.length === 1 && demoView.data[0].workspace_mode === "demo";

const updated = await production.from("workspace_data").update({ payload: { stage: "UPDATE" } }).eq("id", createProduction.data.id);
if (updated.error) throw updated.error;
const deleted = await production.from("workspace_data").update({ deleted_at: new Date().toISOString(), deleted_by: productionAdmin.id, deletion_reason: "Recovery local controlado" }).eq("id", createProduction.data.id);
if (deleted.error) throw deleted.error;
const restored = await production.from("workspace_data").update({ deleted_at: null, deleted_by: null, deletion_reason: null }).eq("id", createProduction.data.id);
if (restored.error) throw restored.error;
const audit = await production.from("audit_log").select("action,resource_id").eq("resource_id", createProduction.data.id);
const auditActions = new Set((audit.data ?? []).map((item) => item.action));
const auditPass = !audit.error && ["CREATE", "UPDATE", "DELETE", "RESTORE"].every((action) => auditActions.has(action));

const signedUrlSamples = [];
for (const category of ["documents", "audits", "corrective-actions", "metrology", "customers", "suppliers", "evidence"]) {
  const objectPath = `${productionAdmin.id}/recovery-probes/${category}/${Date.now()}.txt`;
  const upload = await production.storage.from("integraq-private").upload(objectPath, Buffer.from(`Recovery probe: ${category}`), { contentType: "text/plain", upsert: true });
  if (upload.error) {
    signedUrlSamples.push({ category, result: "FAIL", error: upload.error.message });
    continue;
  }
  const allowedUrl = await production.storage.from("integraq-private").createSignedUrl(objectPath, 60);
  const deniedUrl = await restricted.storage.from("integraq-private").createSignedUrl(objectPath, 60);
  const cleanup = await production.storage.from("integraq-private").remove([objectPath]);
  signedUrlSamples.push({
    category,
    result: !allowedUrl.error && Boolean(allowedUrl.data?.signedUrl) && Boolean(deniedUrl.error) && !cleanup.error ? "PASS" : "FAIL",
    allowError: allowedUrl.error?.message,
    denyError: deniedUrl.error?.message,
    cleanupError: cleanup.error?.message,
  });
}
const signedUrlPass = signedUrlSamples.every((sample) => sample.result === "PASS");

const evidence = {
  result: isolation && auditPass && signedUrlPass ? "PASS" : "FAIL",
  login: "PASS",
  rls: isolation ? "PASS" : "FAIL",
  workspaceIsolation: isolation ? "PASS" : "FAIL",
  softDelete: !deleted.error ? "PASS" : "FAIL",
  restore: !restored.error ? "PASS" : "FAIL",
  auditLog: auditPass ? "PASS" : "FAIL",
  signedUrl: signedUrlPass ? "PASS" : "FAIL",
  signedUrlSamples,
  auditActions: [...auditActions].sort(),
};
await writeEvidence("functional-validation", evidence);
console.log(JSON.stringify(evidence, null, 2));
if (evidence.result !== "PASS") process.exitCode = 1;
