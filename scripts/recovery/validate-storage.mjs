import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { assertRecoveryEnvironment, loadBackup, recoveryEnv, writeEvidence } from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
if (!env.SUPABASE_SECRET_KEY) throw new Error("Falta SUPABASE_SECRET_KEY local.");
const backup = await loadBackup(env);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
if (bucketError) throw bucketError;
const fileObjects = JSON.parse(await readFile(join(backup.root, "database", "file_objects.json"), "utf8"));
const dbPaths = new Set(fileObjects.map((file) => `${file.bucket_id}/${file.object_path}`));
const classifications = [];
let verifiedBytes = 0;

async function listObjects(bucket, prefix = "") {
  const objects = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) objects.push(path);
      else objects.push(...await listObjects(bucket, path));
    }
    if (!data || data.length < 1000) break;
  }
  return objects;
}

for (const [bucket, objects] of Object.entries(backup.manifest.storage.buckets)) {
  const bucketDefinition = buckets.find((item) => item.name === bucket);
  if (!bucketDefinition || bucketDefinition.public) {
    classifications.push({ bucket, path: "*", status: "BUCKET_MISSING_OR_PUBLIC" });
    continue;
  }
  const actualPaths = await listObjects(bucket);
  for (const path of actualPaths) {
    const key = `${bucket}/${path}`;
    if (!dbPaths.has(key)) classifications.push({ bucket, path, status: "MISSING_DB_RECORD" });
  }
  for (const object of objects) {
    const key = `${bucket}/${object.path}`;
    if (!dbPaths.has(key)) {
      classifications.push({ bucket, path: object.path, status: "MISSING_DB_RECORD" });
      continue;
    }
    const { data, error } = await supabase.storage.from(bucket).download(object.path);
    if (error) {
      classifications.push({ bucket, path: object.path, status: "MISSING_FILE", error: error.message });
      continue;
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    classifications.push({ bucket, path: object.path, status: hash === object.sha256 && bytes.length === object.bytes ? "MATCH" : "HASH_OR_SIZE_MISMATCH" });
    verifiedBytes += bytes.length;
  }
}

const manifestPaths = new Set(Object.entries(backup.manifest.storage.buckets).flatMap(([bucket, objects]) => objects.map((object) => `${bucket}/${object.path}`)));
for (const key of dbPaths) {
  if (!manifestPaths.has(key)) classifications.push({ path: key, status: "MISSING_FILE" });
}
const failures = classifications.filter((item) => item.status !== "MATCH");
const evidence = {
  result: failures.length === 0 ? "PASS" : "FAIL",
  bucketPrivate: buckets.some((bucket) => bucket.name === "integraq-private" && bucket.public === false),
  expectedFiles: backup.manifest.storage.files,
  matchedFiles: classifications.filter((item) => item.status === "MATCH").length,
  expectedBytes: backup.manifest.storage.bytes,
  verifiedBytes,
  failures,
};
await writeEvidence("storage-validation", evidence);
console.log(JSON.stringify(evidence, null, 2));
if (evidence.result !== "PASS") process.exitCode = 1;
