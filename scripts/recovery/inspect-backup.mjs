import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { loadBackup, manifestTotals, sha256File, writeEvidence } from "./lib.mjs";

const backup = await loadBackup(process.env);
const totals = manifestTotals(backup.manifest);
const databaseDirectory = join(backup.root, "database");
const storageDirectory = join(backup.root, "storage");
const databaseFiles = (await readdir(databaseDirectory)).filter((name) => name.endsWith(".json"));

async function storageInventory(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await storageInventory(path));
    else result.push({ path, bytes: (await stat(path)).size });
  }
  return result;
}

const storageFiles = await storageInventory(storageDirectory);
const actualBytes = storageFiles.reduce((sum, file) => sum + file.bytes, 0);
const expectedStorage = new Map(
  Object.entries(backup.manifest.storage.buckets).flatMap(([bucket, objects]) =>
    objects.map((object) => [`${bucket}/${object.path}`, object]),
  ),
);
const storageMismatches = [];
for (const file of storageFiles) {
  const key = relative(storageDirectory, file.path).replaceAll("\\", "/");
  const expected = expectedStorage.get(key);
  const actualHash = await sha256File(file.path);
  if (!expected || expected.bytes !== file.bytes || expected.sha256 !== actualHash) {
    storageMismatches.push({ key, expectedBytes: expected?.bytes, actualBytes: file.bytes, expectedSha256: expected?.sha256, actualSha256: actualHash });
  }
}
const schemaPath = join(backup.root, "public-schema.sql");
let schema = { available: false, bytes: 0, sha256: null };
try {
  const schemaStat = await stat(schemaPath);
  schema = { available: schemaStat.size > 0, bytes: schemaStat.size, sha256: await sha256File(schemaPath) };
} catch {
  // The migrations are the authoritative schema when a dump is absent.
}

const checks = {
  databaseJsonFiles: databaseFiles.length === totals.tables,
  storageFiles: storageFiles.length === totals.files,
  storageBytes: actualBytes === totals.bytes,
  storageChecksums: storageMismatches.length === 0,
  warnings: totals.warnings === 0,
};
const result = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
const evidence = {
  result,
  backupId: backup.id,
  createdAt: backup.manifest.createdAt,
  sourceHost: backup.manifest.sourceHost,
  migrationHead: backup.manifest.migrationHead,
  manifestSha256: backup.manifestSha256,
  totals,
  actual: { databaseFiles: databaseFiles.length, storageFiles: storageFiles.length, storageBytes: actualBytes },
  storageMismatches,
  components: {
    database: "DATA_ONLY",
    schema: schema.available ? "DUMP" : "MIGRATIONS_REQUIRED",
    auth: "IDENTITY_WITHOUT_PRODUCTION_PASSWORD_HASHES",
    storage: "BINARY_WITH_SHA256",
    migrations: "REPOSITORY",
    configuration: "NOT_INCLUDED",
  },
  schema,
  checks,
};
await writeEvidence("backup-inspection", evidence);
console.log(JSON.stringify(evidence, null, 2));
if (result !== "PASS") process.exitCode = 1;
