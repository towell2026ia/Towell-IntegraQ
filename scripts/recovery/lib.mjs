import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const projectRoot = resolve(import.meta.dirname, "..", "..");
export const recoveryOutputRoot = join(projectRoot, "outputs", "recovery");
export const recoveryEnvFile = join(projectRoot, ".env.recovery.local");

export function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [key, value];
      }),
  );
}

export async function recoveryEnv() {
  const fileValues = existsSync(recoveryEnvFile) ? parseEnv(await readFile(recoveryEnvFile, "utf8")) : {};
  return { ...fileValues, ...process.env };
}

export function assertRecoveryEnvironment(env, { requireUrl = true } = {}) {
  if (env.APP_ENV !== "recovery-local") {
    throw new Error("ABORT: APP_ENV debe ser exactamente recovery-local.");
  }

  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? env.RECOVERY_SUPABASE_URL;
  if (!rawUrl) {
    if (requireUrl) throw new Error("ABORT: falta NEXT_PUBLIC_SUPABASE_URL para Recovery.");
    return;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("ABORT: NEXT_PUBLIC_SUPABASE_URL no es una URL valida.");
  }
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`ABORT: Recovery solo admite Supabase local; host rechazado: ${url.hostname}`);
  }
}

export function commandVersion(command, args = ["--version"]) {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

export function requireCommand(command, args = ["--version"]) {
  const version = commandVersion(command, args);
  if (!version) throw new Error(`Falta la herramienta requerida: ${command}`);
  return version;
}

export function run(command, args, { env = process.env, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    env,
    shell: false,
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    throw new Error(`${command} termino con codigo ${result.status}.${detail}`);
  }
  return capture ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
}

export async function pipeToCommand(command, args, input, { env = process.env } = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, env, shell: false, stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} termino con codigo ${code}.`)));
    child.stdin.end(input);
  });
}

export async function findBackupRoot(env = process.env) {
  if (env.RECOVERY_BACKUP_DIR) {
    const requested = resolve(projectRoot, env.RECOVERY_BACKUP_DIR);
    if (!existsSync(join(requested, "manifest.json"))) throw new Error(`No existe manifest.json en ${requested}`);
    return requested;
  }
  const root = join(projectRoot, "outputs", "backups");
  const candidates = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "manifest.json")))
    .map((entry) => join(root, entry.name));
  if (!candidates.length) throw new Error("No se encontro un backup con manifest.json en outputs/backups.");
  const manifests = await Promise.all(candidates.map(async (directory) => ({
    directory,
    manifest: JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
  })));
  manifests.sort((left, right) => String(right.manifest.createdAt).localeCompare(String(left.manifest.createdAt)));
  return manifests[0].directory;
}

export async function loadBackup(env = process.env) {
  const root = await findBackupRoot(env);
  const manifestPath = join(root, "manifest.json");
  const raw = await readFile(manifestPath);
  return {
    root,
    id: basename(root),
    manifestPath,
    manifest: JSON.parse(raw.toString("utf8")),
    manifestSha256: createHash("sha256").update(raw).digest("hex"),
  };
}

export function manifestTotals(manifest) {
  return {
    tables: Object.keys(manifest.tables ?? {}).length,
    rows: Object.values(manifest.tables ?? {}).reduce((sum, value) => sum + Number(value), 0),
    users: Number(manifest.authUsers ?? 0),
    files: Number(manifest.storage?.files ?? 0),
    bytes: Number(manifest.storage?.bytes ?? 0),
    warnings: manifest.warnings?.length ?? 0,
  };
}

export async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function writeEvidence(stage, evidence) {
  await mkdir(recoveryOutputRoot, { recursive: true });
  const path = join(recoveryOutputRoot, `${stage}.json`);
  await writeFile(path, `${JSON.stringify({ recordedAt: new Date().toISOString(), ...evidence }, null, 2)}\n`);
  return path;
}

export function parseCliEnv(text) {
  return Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(?:"(.*)"|(.*))$/);
      return match ? [[match[1], match[2] ?? match[3] ?? ""]] : [];
    }),
  );
}

export function escapeIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Identificador SQL rechazado: ${value}`);
  return `"${value.replaceAll('"', '""')}"`;
}

export function recoveryDbContainer(env = process.env) {
  return env.RECOVERY_DB_CONTAINER || "supabase_db_integraq-recovery";
}
