import { assertRecoveryEnvironment, recoveryEnv, run, writeEvidence } from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
const startedAt = new Date();
const stages = [
  ["schema", "scripts/recovery/reset-schema.mjs"],
  ["auth", "scripts/recovery/restore-auth.mjs"],
  ["database", "scripts/recovery/restore-database.mjs"],
  ["storage", "scripts/recovery/restore-storage.mjs"],
];
const durations = [];
for (const [name, script] of stages) {
  const stageStartedAt = Date.now();
  run("node", [script], { env });
  durations.push({ name, durationMs: Date.now() - stageStartedAt });
}
const evidence = {
  result: "PASS",
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  stages: durations,
};
await writeEvidence("restore", evidence);
console.log(JSON.stringify(evidence, null, 2));
