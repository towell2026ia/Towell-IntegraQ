import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PROJECT, VERSION, validateSnapshot } from "./home-appearance.mjs";

export class RepairDiagnosticError extends Error {
  constructor(stage, code, details = {}) {
    super(`${stage}: ${code}`);
    this.stage = stage;
    this.code = code;
    this.httpStatus = details.httpStatus;
    this.exitCode = details.exitCode;
  }
}

// Never include an exception message, CLI output, API body or connection URL.
export function diagnosticLine(error) {
  if (!(error instanceof RepairDiagnosticError)) return "FAIL: stage=unknown; code=UNCLASSIFIED";
  const parts = [`FAIL: stage=${error.stage}`, `code=${error.code}`];
  if (Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599)
    parts.push(`http_status=${error.httpStatus}`);
  if (Number.isInteger(error.exitCode) && error.exitCode >= 0 && error.exitCode <= 255)
    parts.push(`cli_exit=${error.exitCode}`);
  return parts.join("; ");
}

export function classifyCliFailure(output = "") {
  if (/IPv6 is not supported on your current network/i.test(output)) return "IPV6_UNSUPPORTED";
  if (/password authentication failed|failed SASL auth|invalid SCRAM/i.test(output)) return "AUTHENTICATION_FAILED";
  if (/permission denied|insufficient privilege/i.test(output)) return "PERMISSION_DENIED";
  if (/connection refused/i.test(output)) return "CONNECTION_REFUSED";
  if (/no such host|could not translate host name/i.test(output)) return "DNS_FAILURE";
  if (/unknown flag|invalid argument|accepts? .*arg/i.test(output)) return "INVALID_ARGUMENT";
  return "EXIT_NONZERO_UNCLASSIFIED";
}

// Supabase's shared session pooler is IPv4-only. Obtain its host from the
// project API rather than guessing the region or adding a new secret.
export async function sessionPoolerUrl(token, password, fetcher = fetch) {
  if (!token || !password) throw new RepairDiagnosticError("pooler_discovery", "MISSING_CREDENTIAL");
  let response;
  try {
    response = await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}/config/database/pooler`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new RepairDiagnosticError("pooler_discovery", "REQUEST_FAILED");
  }
  if (!response.ok) throw new RepairDiagnosticError("pooler_discovery", "HTTP_ERROR", { httpStatus: response.status });
  let configs;
  try { configs = await response.json(); }
  catch { throw new RepairDiagnosticError("pooler_discovery", "INVALID_RESPONSE"); }
  if (!Array.isArray(configs)) throw new RepairDiagnosticError("pooler_discovery", "INVALID_RESPONSE");
  const hosts = [...new Set(configs.filter(c =>
    c && c.database_type === "PRIMARY" &&
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(c.db_host) &&
    (!c.db_user || ["postgres", `postgres.${PROJECT}`].includes(c.db_user)) &&
    (!c.db_name || c.db_name === "postgres")
  ).map(c => c.db_host))];
  if (hosts.length !== 1) throw new RepairDiagnosticError("connection_validation", hosts.length ? "AMBIGUOUS_POOLER" : "NO_PRIMARY_SHARED_POOLER");
  let url;
  try {
    url = new URL(`postgresql://postgres.${PROJECT}@${hosts[0]}:5432/postgres`);
    url.password = password;
    url.searchParams.set("sslmode", "require");
  } catch {
    throw new RepairDiagnosticError("connection_validation", "URL_CONSTRUCTION_FAILED");
  }
  if (url.hostname !== hosts[0] || url.port !== "5432" || url.username !== `postgres.${PROJECT}` || !url.password)
    throw new RepairDiagnosticError("connection_validation", "URL_VALIDATION_FAILED");
  return url.toString();
}

export async function repairOverIpv4(env = process.env, fetcher = fetch, run = spawnSync) {
  if (env.EXPECTED_PROJECT_REF !== PROJECT || !env.RUNNER_TEMP)
    throw new RepairDiagnosticError("preflight_guard", "INVALID_RUNNER_CONTEXT");
  try {
    const before = JSON.parse(await readFile(join(env.RUNNER_TEMP, "home-appearance-before.json"), "utf8"));
    validateSnapshot(before, "pre");
  } catch {
    throw new RepairDiagnosticError("preflight_guard", "BASELINE_INVALID");
  }
  const url = await sessionPoolerUrl(env.SUPABASE_ACCESS_TOKEN, env.SUPABASE_DB_PASSWORD, fetcher);
  let result;
  try {
    result = run("supabase", ["migration", "repair", VERSION, "--status", "applied", "--db-url", url, "--workdir", "approved-source"], {
      encoding: "utf8", stdio: "pipe", timeout: 120000,
      env: { ...env, SUPABASE_DB_PASSWORD: "" },
    });
  } catch {
    throw new RepairDiagnosticError("cli_invocation", "SPAWN_EXCEPTION");
  }
  if (result.error) {
    const code = ["ENOENT", "EACCES", "ETIMEDOUT"].includes(result.error.code) ? result.error.code : "SPAWN_ERROR";
    throw new RepairDiagnosticError("cli_invocation", code);
  }
  // Classify the captured output; never forward it because it may contain the URL.
  if (result.status !== 0) throw new RepairDiagnosticError("repair_result", classifyCliFailure(`${result.stderr ?? ""}\n${result.stdout ?? ""}`), { exitCode: result.status });
  console.log(`CLI completed for migration ${VERSION} through the IPv4 session pooler; postflight still required`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  repairOverIpv4().catch(error => {
    console.error(diagnosticLine(error));
    process.exitCode = 1;
  });
}
