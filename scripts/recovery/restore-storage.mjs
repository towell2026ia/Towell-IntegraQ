import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { assertRecoveryEnvironment, loadBackup, recoveryEnv, sha256File, writeEvidence } from "./lib.mjs";

const env = await recoveryEnv();
assertRecoveryEnvironment(env);
if (!env.SUPABASE_SECRET_KEY) throw new Error("Falta SUPABASE_SECRET_KEY local.");
const backup = await loadBackup(env);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const fileObjects = JSON.parse(await readFile(join(backup.root, "database", "file_objects.json"), "utf8"));
const contentTypes = new Map(fileObjects.map((file) => [`${file.bucket_id}/${file.object_path}`, file.mime_type]));
const startedAt = new Date();
let restoredFiles = 0;
let restoredBytes = 0;

for (const [bucket, objects] of Object.entries(backup.manifest.storage.buckets)) {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  const current = buckets.find((item) => item.name === bucket);
  const bucketResult = current
    ? await supabase.storage.updateBucket(bucket, { public: false })
    : await supabase.storage.createBucket(bucket, { public: false });
  if (bucketResult.error) throw bucketResult.error;

  for (const object of objects) {
    const path = join(backup.root, "storage", bucket, ...object.path.split("/"));
    const actualHash = await sha256File(path);
    if (actualHash !== object.sha256) throw new Error(`Checksum invalido antes de cargar: ${bucket}/${object.path}`);
    const bytes = await readFile(path);
    const { error } = await supabase.storage.from(bucket).upload(object.path, bytes, {
      upsert: true,
      contentType: contentTypes.get(`${bucket}/${object.path}`) || "application/octet-stream",
    });
    if (error) throw new Error(`Storage ${bucket}/${object.path}: ${error.message}`);
    restoredFiles += 1;
    restoredBytes += bytes.length;
  }
}

const evidence = {
  result: restoredFiles === backup.manifest.storage.files && restoredBytes === backup.manifest.storage.bytes ? "PASS" : "FAIL",
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  bucketPrivacy: "PRIVATE",
  expectedFiles: backup.manifest.storage.files,
  restoredFiles,
  expectedBytes: backup.manifest.storage.bytes,
  restoredBytes,
};
await writeEvidence("storage-restore", evidence);
console.log(JSON.stringify(evidence, null, 2));
if (evidence.result !== "PASS") process.exitCode = 1;
