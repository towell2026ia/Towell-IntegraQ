import { assertRecoveryEnvironment, recoveryEnv, requireCommand, run, writeEvidence } from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
requireCommand("supabase");
const startedAt = new Date();
run("supabase", ["db", "reset", "--local"], { env });
const evidence = {
  result: "PASS",
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  strategy: "MIGRATIONS_THEN_DATA",
};
await writeEvidence("schema", evidence);
console.log(JSON.stringify(evidence, null, 2));
