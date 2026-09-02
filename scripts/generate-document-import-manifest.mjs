import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "carga-documental");
const manifestPath = path.join(projectRoot, "src", "lib", "document-import-manifest.json");
const controlPath = path.join(sourceRoot, "CONTROL_CARGA.csv");

const typeByFolderNumber = {
  1: { clientId: "processes", databaseId: "process", label: "Procesos", code: "PRO" },
  2: { clientId: "manuals", databaseId: "manual", label: "Manuales", code: "MAN" },
  3: { clientId: "procedures", databaseId: "procedure", label: "Procedimientos", code: "PRC" },
  4: { clientId: "instructions", databaseId: "instruction", label: "Instructivos", code: "INS" },
  5: { clientId: "forms", databaseId: "format", label: "Formatos", code: "FOR" },
  6: { clientId: "application-forms", databaseId: "form", label: "Formularios", code: "FML" },
  7: { clientId: "standard-operation-sheets", databaseId: "standard-operation-sheet", label: "Hojas de Operación Estándar", code: "HOE" },
  8: { clientId: "visual-aids", databaseId: "visual-aid", label: "Ayudas visuales", code: "AV" },
};

const processValidators = {
  "P-01": { owner: "Gerencia de Cuentas Clave", positionId: "PU-11" },
  "P-02": { owner: "Jefatura de Diseño", positionId: "PU-13" },
  "P-03": { owner: "Dirección General", positionId: "PU-01" },
  "P-04": { owner: "Jefatura de Planeación", positionId: "PU-26" },
  "P-05": { owner: "Jefatura de Seguridad, Higiene y Medio Ambiente", positionId: "PU-15" },
  "P-06": { owner: "Gerencia de Contabilidad", positionId: "PU-20" },
  "P-07": { owner: "Gerencia de Tecnologías de Información", positionId: "PU-09" },
  "P-08": { owner: "Gerencia de Aseguramiento de Calidad", positionId: "PU-07" },
  "P-09": { owner: "Jefatura de Almacén", positionId: "PU-27" },
  "P-10": { owner: "Jefatura de Compras", positionId: "PU-18" },
  "P-11": { owner: "Gerencia de Recursos Humanos", positionId: "PU-10" },
  "P-12": { owner: "Jefatura de Mantenimiento", positionId: "PU-25" },
  "P-13": { owner: "Jefatura de Tejido", positionId: "PU-12" },
  "P-17": { owner: "Jefatura de Teñido", positionId: "PU-14" },
  "P-22": { owner: "Gerencia de Manufactura", positionId: "PU-06" },
  "P-31": { owner: "Gerencia de Logística y Distribución", positionId: "PU-08" },
  "P-34": { owner: "Gerencia de Logística y Distribución", positionId: "PU-08" },
  "P-35": { owner: "Gerencia de Aseguramiento de Calidad", positionId: "PU-07" },
};

const skippedNames = new Set(["LEEME.md", "CONTROL_CARGA.csv", "desktop.ini", "Thumbs.db"]);
const mimeTypeByExtension = {
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    if (entry.isFile() && !skippedNames.has(entry.name) && !entry.name.startsWith("~$")) {
      files.push(absolutePath);
    }
  }
  return files;
}

function normalizeRelativePath(absolutePath) {
  return path.relative(sourceRoot, absolutePath).split(path.sep).join("/");
}

function safeObjectName(fileName) {
  return fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-140);
}

function deterministicUuid(value) {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function extractRevision(baseName) {
  const patterns = [
    /(?:^|[_\s-])REV(?:ISI[ÓO]N)?[\s._-]*(\d{1,3})(?=[^0-9]|$)/i,
    /(?:^|[_\s-])V[\s._-]*(\d{1,3})(?=[^0-9]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = baseName.match(pattern);
    if (match) return Number(match[1]);
  }
  return 0;
}

function extractCode(baseName) {
  const cleaned = baseName.replace(/^%+/, "").trim();
  const match = cleaned.match(/^([A-ZÁÉÍÓÚÑ]{1,8}(?:-[A-ZÁÉÍÓÚÑ0-9]{1,12})*-\d{1,4})/i);
  return match?.[1]?.toLocaleUpperCase("es-MX") ?? null;
}

function extractTitle(baseName, code) {
  let title = baseName;
  if (code && title.toLocaleUpperCase("es-MX").startsWith(code)) {
    title = title.slice(code.length);
  }
  title = title
    .replace(/(?:^|[_\s-])REV(?:ISI[ÓO]N)?[\s._-]*\d{1,3}(?=[^0-9]|$)/gi, " ")
    .replace(/(?:^|[_\s-])V[\s._-]*\d{1,3}(?=[^0-9]|$)/gi, " ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s_.-]+|[\s_.-]+$/g, "")
    .trim();
  return title || code || baseName;
}

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const absoluteFiles = (await walk(sourceRoot)).sort((left, right) =>
  normalizeRelativePath(left).localeCompare(normalizeRelativePath(right), "es-MX"),
);
const codeOccurrences = new Map();
const manifest = [];

for (const absolutePath of absoluteFiles) {
  const relativePath = normalizeRelativePath(absolutePath);
  const parts = relativePath.split("/");
  if (parts.length < 3) continue;

  const processId = parts[0].match(/^(P-\d{2})/)?.[1];
  const folderNumber = Number(parts[1].match(/^0?([1-8])(?:[_\s]|$)/)?.[1]);
  const documentType = typeByFolderNumber[folderNumber];
  if (!processId || !documentType) {
    throw new Error(`No se pudo clasificar ${relativePath}`);
  }

  const fileStats = await stat(absolutePath);
  const content = await readFile(absolutePath);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const extension = path.extname(absolutePath);
  const baseName = path.basename(absolutePath, extension);
  const sourceCode = extractCode(baseName);
  const generatedCode = `IMP-${processId.slice(2)}-${documentType.code}-${sha256.slice(0, 8).toLocaleUpperCase("es-MX")}`;
  const baseCode = sourceCode ?? generatedCode;
  const occurrence = (codeOccurrences.get(baseCode) ?? 0) + 1;
  codeOccurrences.set(baseCode, occurrence);
  const code = occurrence === 1 ? baseCode : `${baseCode}-${occurrence}`;
  const validator = processValidators[processId] ?? {
    owner: "Responsable del proceso",
    positionId: null,
  };
  const storageObjectPath = `bulk-documents/${processId}/${documentType.databaseId}/${sha256.slice(0, 16)}-${safeObjectName(path.basename(absolutePath))}`;

  manifest.push({
    id: deterministicUuid(`controlled-document:${relativePath}`),
    versionId: deterministicUuid(`controlled-document-version:${relativePath}`),
    fileObjectId: deterministicUuid(`file-object:${storageObjectPath}`),
    processId,
    documentTypeId: documentType.clientId,
    databaseDocumentTypeId: documentType.databaseId,
    code,
    sourceCode,
    name: extractTitle(baseName, sourceCode),
    owner: validator.owner,
    validator: validator.owner,
    validatorPositionId: validator.positionId,
    revision: extractRevision(baseName),
    status: "pending",
    fileName: path.basename(absolutePath),
    sourceRelativePath: relativePath,
    storageBucket: "integraq-private",
    storageObjectPath,
    modifiedAt: fileStats.mtime.toISOString(),
    sizeBytes: fileStats.size,
    mimeType: mimeTypeByExtension[extension.toLocaleLowerCase("en-US")] ?? "application/octet-stream",
    sha256,
  });
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const controlRows = [
  ["proceso_id", "tipo_documental", "nombre_archivo", "codigo_documento", "revision", "fecha_modificacion", "responsable_carga", "validador", "observaciones"],
  ...manifest.map((document) => [
    document.processId,
    document.documentTypeId,
    document.fileName,
    document.code,
    document.revision,
    document.modifiedAt,
    "Carga documental masiva",
    document.validator,
    "Pendiente de autorización por la jefatura del área",
  ]),
];
await writeFile(controlPath, `${controlRows.map((row) => row.map(csv).join(",")).join("\r\n")}\r\n`, "utf8");

const totalBytes = manifest.reduce((sum, document) => sum + document.sizeBytes, 0);
console.log(JSON.stringify({ documents: manifest.length, totalBytes, manifestPath, controlPath }));
