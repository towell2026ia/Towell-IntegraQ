import { assertRecoveryEnvironment, recoveryEnv, run } from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
run("pnpm", ["dev"], { env });
