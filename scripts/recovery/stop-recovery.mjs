import { assertRecoveryEnvironment, recoveryEnv, requireCommand, run, writeEvidence } from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
requireCommand("supabase");
run("supabase", ["stop"], { env });
const evidence = { result: "PASS", stoppedAt: new Date().toISOString(), volumesRemoved: false };
await writeEvidence("stop", evidence);
console.log(JSON.stringify(evidence, null, 2));
