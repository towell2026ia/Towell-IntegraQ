import { writeFile } from "node:fs/promises";

import {
  assertRecoveryEnvironment,
  parseCliEnv,
  recoveryEnvFile,
  requireCommand,
  run,
  writeEvidence,
} from "./lib.mjs";

assertRecoveryEnvironment(process.env, { requireUrl: false });
const versions = {
  docker: requireCommand("docker"),
  supabase: requireCommand("supabase"),
  node: requireCommand("node"),
  pnpm: requireCommand("pnpm"),
  git: requireCommand("git"),
};
const startedAt = new Date();
run("supabase", ["start"]);
const local = parseCliEnv(run("supabase", ["status", "-o", "env"], { capture: true }));
const apiUrl = local.API_URL ?? local.SUPABASE_URL;
if (!apiUrl) throw new Error("Supabase CLI no devolvio API_URL.");
assertRecoveryEnvironment({ APP_ENV: "recovery-local", NEXT_PUBLIC_SUPABASE_URL: apiUrl });

const lines = [
  "# Generado por pnpm recovery:start. No versionar.",
  "APP_ENV=recovery-local",
  "NEXT_PUBLIC_APP_ENV=recovery-local",
  `NEXT_PUBLIC_SUPABASE_URL=${apiUrl}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${local.ANON_KEY ?? local.PUBLISHABLE_KEY ?? ""}`,
  `SUPABASE_SECRET_KEY=${local.SERVICE_ROLE_KEY ?? local.SECRET_KEY ?? ""}`,
  `SUPABASE_DB_URL=${local.DB_URL ?? ""}`,
  "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000",
  "RECOVERY_DEFAULT_PASSWORD=",
  "",
];
await writeFile(recoveryEnvFile, lines.join("\n"), { mode: 0o600 });
const evidence = {
  result: "PASS",
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  versions,
  endpoints: {
    api: apiUrl,
    database: local.DB_URL ? "LOCAL_CONFIGURED" : "NOT_REPORTED",
    studio: local.STUDIO_URL ?? "NOT_REPORTED",
    storage: `${apiUrl}/storage/v1`,
    auth: `${apiUrl}/auth/v1`,
  },
  envFile: ".env.recovery.local",
};
await writeEvidence("start", evidence);
console.log(JSON.stringify(evidence, null, 2));
