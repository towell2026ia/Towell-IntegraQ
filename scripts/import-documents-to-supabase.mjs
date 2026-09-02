import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "carga-documental");
const manifestPath = path.join(projectRoot, "src", "lib", "document-import-manifest.json");
const applyImport = process.argv.includes("--apply");
const checkOnly = process.argv.includes("--check");

function argumentValue(name) {
  const argument = process.argv.find((value) => value.startsWith(`${name}=`));
  return argument?.slice(name.length + 1) || null;
}

const requestedProcessId = argumentValue("--process");
const requestedDocumentTypeId = argumentValue("--document-type");

function readEnvironment(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
        return [key, value];
      }),
  );
}

function deterministicUuid(value) {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

async function mapConcurrent(items, concurrency, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function assertNoError(operation, label) {
  const result = await operation;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const localEnvironment = readEnvironment(await readFile(path.join(projectRoot, ".env.local"), "utf8"));
const supabaseUrl = localEnvironment.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = localEnvironment.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !secretKey) {
  throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local.");
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const completeManifest = JSON.parse(await readFile(manifestPath, "utf8"));
const manifest = completeManifest.filter((document) =>
  (!requestedProcessId || document.processId === requestedProcessId)
  && (!requestedDocumentTypeId || document.documentTypeId === requestedDocumentTypeId),
);
if (!manifest.length) {
  throw new Error("El filtro solicitado no contiene documentos para importar.");
}

if (checkOnly) {
  const probe = await fetch(`${supabaseUrl}/rest/v1/processes?select=id&limit=1`, {
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
  });
  console.log(JSON.stringify({
    authProbeStatus: probe.status,
    authProbeServerDate: probe.headers.get("date"),
    authProbeResponse: await probe.text(),
    localUtc: new Date().toISOString(),
  }));
}

const [profiles, processes, documentTypes, currentDocuments, currentVersions, storedFiles] = await Promise.all([
  assertNoError(
    supabase.from("profiles").select("id, full_name, user_type, position_id, status, created_at").eq("status", "active"),
    "No se pudieron consultar perfiles",
  ),
  assertNoError(supabase.from("processes").select("id, name"), "No se pudieron consultar procesos"),
  assertNoError(supabase.from("document_types").select("id"), "No se pudieron consultar tipos documentales"),
  assertNoError(supabase.from("controlled_documents").select("id, code, process_id, document_type_id"), "No se pudieron consultar documentos"),
  assertNoError(supabase.from("controlled_document_versions").select("id, status"), "No se pudieron consultar versiones"),
  assertNoError(supabase.from("file_objects").select("id").eq("resource_type", "controlled_document"), "No se pudieron consultar archivos"),
]);

const uploader = [...profiles].sort((left, right) => {
  const leftRank = left.user_type === "administrator" ? 0 : 1;
  const rightRank = right.user_type === "administrator" ? 0 : 1;
  return leftRank - rightRank || String(left.created_at).localeCompare(String(right.created_at));
})[0];
const availableProcessIds = new Set(processes.map((process) => process.id));
const availableDocumentTypeIds = new Set(documentTypes.map((type) => type.id));
const missingProcesses = [...new Set(manifest.map((document) => document.processId))]
  .filter((processId) => !availableProcessIds.has(processId));
const missingDocumentTypes = [...new Set(manifest.map((document) => document.databaseDocumentTypeId))]
  .filter((typeId) => !availableDocumentTypeIds.has(typeId));
const currentDocumentIds = new Set(currentDocuments.map((document) => document.id));
const matchingManifestIds = manifest.filter((document) =>
  currentDocumentIds.has(deterministicUuid(`controlled-document:${document.sourceRelativePath}`)),
).length;
const appQueryProbe = await assertNoError(
  supabase.from("controlled_documents").select(`
    id,
    owner:profiles!controlled_documents_owner_id_fkey(full_name),
    versions:controlled_document_versions(
      id,
      uploader:profiles!controlled_document_versions_uploaded_by_fkey(full_name),
      validator:profiles!controlled_document_versions_validator_id_fkey(full_name),
      file:file_objects!controlled_document_versions_file_id_fkey(id, bucket_id, object_path)
    )
  `).limit(1),
  "La consulta documental usada por la app no es válida",
);

const summary = {
  mode: checkOnly ? "check" : applyImport ? "apply" : "dry-run",
  requestedProcessId,
  requestedDocumentTypeId,
  catalogDocuments: completeManifest.length,
  manifestDocuments: manifest.length,
  currentDocuments: currentDocuments.length,
  matchingManifestIds,
  pendingVersions: currentVersions.filter((version) => version.status === "pending").length,
  storedFiles: storedFiles.length,
  activeProfiles: profiles.length,
  uploader: uploader?.full_name ?? null,
  missingProcesses,
  missingDocumentTypes,
  appQueryReady: appQueryProbe.length === 1 || currentDocuments.length === 0,
};
console.log(JSON.stringify(summary));

if (checkOnly) process.exit(0);
if (!applyImport) {
  console.log("Dry-run terminado. Usa --apply para subir archivos y metadatos.");
  process.exit(0);
}
if (!uploader) throw new Error("No existe un perfil activo para registrar la carga masiva.");
if (missingProcesses.some((processId) => processId !== "P-35") || missingDocumentTypes.length) {
  throw new Error("La base requiere las migraciones pendientes antes de ejecutar la carga masiva.");
}

await assertNoError(
  supabase.from("processes").upsert([
    { id: "P-11", name: "Recursos Humanos", level: "process", parent_id: null, source_label: "Recursos Humanos" },
    { id: "P-35", name: "Sistemas de Gestión de Calidad", level: "process", parent_id: null, source_label: "Sistemas de Gestión de Calidad" },
  ], { onConflict: "id" }),
  "No se pudieron actualizar P-11 y P-35",
);
await assertNoError(
  supabase.from("position_process_permissions").upsert([
    { position_id: "PU-10", process_id: "P-11", relationship: "owner", document_role: "modifier" },
    { position_id: "PU-01", process_id: "P-35", relationship: "approver", document_role: "authorizer" },
    { position_id: "PU-07", process_id: "P-35", relationship: "owner", document_role: "modifier" },
    { position_id: "PU-16", process_id: "P-35", relationship: "participant", document_role: "viewer" },
  ], { onConflict: "position_id,process_id" }),
  "No se pudieron registrar permisos de P-11 y P-35",
);
const newUserProcessPermissions = profiles.flatMap((profile) => {
  const permissionByPosition = {
    "PU-10": { process_id: "P-11", document_role: "modifier" },
    "PU-01": { process_id: "P-35", document_role: "authorizer" },
    "PU-07": { process_id: "P-35", document_role: "modifier" },
    "PU-16": { process_id: "P-35", document_role: "viewer" },
  };
  const permission = permissionByPosition[profile.position_id];
  return permission ? [{
    user_id: profile.id,
    ...permission,
    source: "position",
    inherited_from_position_id: profile.position_id,
  }] : [];
});
if (newUserProcessPermissions.length) {
  await assertNoError(
    supabase.from("user_process_permissions").upsert(newUserProcessPermissions, {
      onConflict: "user_id,process_id",
    }),
    "No se pudieron sincronizar permisos de usuarios para P-11 y P-35",
  );
}

const profileByPosition = new Map(
  profiles.filter((profile) => profile.position_id).map((profile) => [profile.position_id, profile]),
);
const currentDocumentByCode = new Map(
  currentDocuments.map((document) => [String(document.code).toLocaleUpperCase("es-MX"), document]),
);
const prepared = manifest.map((document) => {
  const currentDocument = currentDocumentByCode.get(document.code.toLocaleUpperCase("es-MX"));
  const documentId = currentDocument?.id ?? deterministicUuid(`controlled-document:${document.sourceRelativePath}`);
  const validatorProfile = profileByPosition.get(document.validatorPositionId);
  return {
    ...document,
    documentId,
    versionUuid: deterministicUuid(`controlled-document-version:${document.sourceRelativePath}`),
    fileObjectId: deterministicUuid(`file-object:${document.storageObjectPath}`),
    uploadedBy: uploader.id,
    validatorId: validatorProfile?.id ?? null,
  };
});

let uploadedFiles = 0;
await mapConcurrent(prepared, 5, async (document) => {
  const file = await readFile(path.join(sourceRoot, ...document.sourceRelativePath.split("/")));
  const { error } = await supabase.storage
    .from(document.storageBucket)
    .upload(document.storageObjectPath, file, {
      contentType: document.mimeType,
      cacheControl: "3600",
      upsert: true,
    });
  if (error) throw new Error(`${document.sourceRelativePath}: ${error.message}`);
  uploadedFiles += 1;
  if (uploadedFiles % 25 === 0 || uploadedFiles === prepared.length) {
    console.log(`Archivos ${uploadedFiles}/${prepared.length}`);
  }
});

for (const batch of chunks(prepared, 75)) {
  await assertNoError(
    supabase.from("controlled_documents").upsert(
      batch.map((document) => ({
        id: document.documentId,
        process_id: document.processId,
        document_type_id: document.databaseDocumentTypeId,
        code: document.code,
        title: document.name,
        description: `Carga masiva desde ${document.sourceRelativePath}`,
        owner_id: document.validatorId ?? uploader.id,
        active: true,
        created_by: uploader.id,
        created_at: document.modifiedAt,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    ),
    "No se pudieron registrar documentos",
  );

  await assertNoError(
    supabase.from("file_objects").upsert(
      batch.map((document) => ({
        id: document.fileObjectId,
        bucket_id: document.storageBucket,
        object_path: document.storageObjectPath,
        original_name: document.fileName,
        mime_type: document.mimeType,
        size_bytes: document.sizeBytes,
        sha256: document.sha256,
        process_id: document.processId,
        module_id: "documents",
        audience: "internal",
        resource_type: "controlled_document",
        resource_id: document.documentId,
        category: document.databaseDocumentTypeId,
        uploaded_by: uploader.id,
        created_at: document.modifiedAt,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    ),
    "No se pudieron registrar archivos",
  );
}

const preparedDocumentIds = [...new Set(prepared.map((document) => document.documentId))];
const existingVersions = [];
for (const documentIdBatch of chunks(preparedDocumentIds, 100)) {
  const rows = await assertNoError(
    supabase
      .from("controlled_document_versions")
      .select("id, document_id, revision")
      .in("document_id", documentIdBatch),
    "No se pudieron consultar versiones existentes",
  );
  existingVersions.push(...rows);
}
const currentVersionByKey = new Map(
  existingVersions.map((version) => [`${version.document_id}:${version.revision}`, version.id]),
);

for (const batch of chunks(prepared, 75)) {
  const submittedAt = new Date().toISOString();
  await assertNoError(
    supabase.from("controlled_document_versions").upsert(
      batch.map((document) => ({
        id: currentVersionByKey.get(`${document.documentId}:${document.revision}`) ?? document.versionUuid,
        document_id: document.documentId,
        revision: document.revision,
        status: "pending",
        file_id: document.fileObjectId,
        file_name: document.fileName,
        change_reason: "Carga masiva inicial; pendiente de autorización por la jefatura del área",
        uploaded_by: uploader.id,
        validator_id: document.validatorId,
        submitted_by: uploader.id,
        submitted_at: submittedAt,
        authorized_by: null,
        authorized_at: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        created_at: document.modifiedAt,
        updated_at: submittedAt,
      })),
      { onConflict: "document_id,revision" },
    ),
    "No se pudieron registrar versiones pendientes",
  );
}

console.log(JSON.stringify({ importedDocuments: prepared.length, uploadedFiles, status: "pending" }));
