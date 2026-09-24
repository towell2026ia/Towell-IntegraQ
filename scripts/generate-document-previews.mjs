import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

import { createClient } from "@supabase/supabase-js";

const execute = promisify(execFile);
const officeBinary = process.env.LIBREOFFICE_BIN || "soffice";
const batchLimit = Number(process.argv.find((value) => value.startsWith("--limit="))?.split("=")[1] || 10);
const env = await loadLocalEnvironment();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: queue, error: queueError } = await supabase.from("file_objects")
  .select("id,bucket_id,object_path,original_name,mime_type")
  .eq("preview_status", "pending")
  .is("deleted_at", null)
  .order("created_at")
  .limit(batchLimit);
if (queueError) throw queueError;

for (const item of queue ?? []) {
  await processPreview(item);
}

async function processPreview(item) {
  const claimed = await supabase.from("file_objects")
    .update({ preview_status: "processing", preview_error: null })
    .eq("id", item.id)
    .eq("preview_status", "pending")
    .select("id")
    .maybeSingle();
  if (claimed.error || !claimed.data) return;

  const workDirectory = await mkdtemp(join(tmpdir(), "integraq-preview-"));
  try {
    const source = await supabase.storage.from(item.bucket_id).download(item.object_path);
    if (source.error) throw source.error;
    const extension = extname(item.original_name) || extensionForMime(item.mime_type);
    const sourcePath = join(workDirectory, `original${extension}`);
    await writeFile(sourcePath, Buffer.from(await source.data.arrayBuffer()));
    await execute(officeBinary, [
      "--headless",
      "--convert-to", "pdf",
      "--outdir", workDirectory,
      sourcePath,
    ], { timeout: 120_000, windowsHide: true });
    const pdfPath = join(workDirectory, `${basename(sourcePath, extension)}.pdf`);
    const pdf = await readFile(pdfPath);
    const previewPath = item.object_path.replace(/\/[^/]+$/, "/preview.pdf");
    const uploaded = await supabase.storage.from(item.bucket_id).upload(previewPath, pdf, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: true,
    });
    if (uploaded.error) throw uploaded.error;
    const updated = await supabase.from("file_objects").update({
      preview_path: previewPath,
      preview_status: "ready",
      preview_generated_at: new Date().toISOString(),
      preview_error: null,
    }).eq("id", item.id);
    if (updated.error) throw updated.error;
    console.log(`ready ${item.id} ${item.original_name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("file_objects").update({
      preview_status: "error",
      preview_error: message.slice(0, 2000),
    }).eq("id", item.id);
    console.error(`error ${item.id} ${item.original_name}: ${message}`);
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function loadLocalEnvironment() {
  const values = { ...process.env };
  if (!values.NEXT_PUBLIC_SUPABASE_URL || !values.SUPABASE_SECRET_KEY) {
    const text = await readFile(".env.local", "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
      const index = line.indexOf("=");
      values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
  }
  if (!values.NEXT_PUBLIC_SUPABASE_URL || !values.SUPABASE_SECRET_KEY) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY.");
  }
  return values;
}

function extensionForMime(mime) {
  if (mime?.includes("wordprocessingml")) return ".docx";
  if (mime?.includes("spreadsheetml")) return ".xlsx";
  if (mime?.includes("presentationml")) return ".pptx";
  if (mime?.includes("ms-excel")) return ".xls";
  if (mime?.includes("msword")) return ".doc";
  if (mime?.includes("powerpoint")) return ".ppt";
  return ".bin";
}
