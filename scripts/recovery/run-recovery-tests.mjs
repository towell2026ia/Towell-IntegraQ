import { assertRecoveryEnvironment, recoveryEnv, run, writeEvidence } from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
const startedAt = new Date();
const stages = [
  ["database", "node", ["scripts/recovery/validate-database.mjs"]],
  ["auth", "node", ["scripts/recovery/validate-auth.mjs"]],
  ["storage", "node", ["scripts/recovery/validate-storage.mjs"]],
  ["functional", "node", ["scripts/recovery/validate-functional.mjs"]],
  ["tests", "pnpm", ["test"]],
  ["typecheck", "pnpm", ["typecheck"]],
  ["lint", "pnpm", ["lint"]],
  ["build", "pnpm", ["build"]],
];
const results = [];
for (const [name, command, args] of stages) {
  const stageStartedAt = Date.now();
  try {
    run(command, args, { env });
    results.push({ name, result: "PASS", durationMs: Date.now() - stageStartedAt });
  } catch (error) {
    results.push({ name, result: "FAIL", durationMs: Date.now() - stageStartedAt, error: error.message });
  }
}
const evidence = {
  result: results.every((item) => item.result === "PASS") ? "PASS" : "FAIL",
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  stages: results,
};
await writeEvidence("validation", evidence);
console.log(JSON.stringify(evidence, null, 2));
if (evidence.result !== "PASS") process.exitCode = 1;
