import type { AppFormField, AppFormFieldType } from "@/lib/form-data";

export type FormImportSource = "excel" | "image";

export interface FormImportDraft {
  sourceType: FormImportSource;
  sourceName: string;
  sheetName?: string;
  registrationNumber: string;
  name: string;
  fields: AppFormField[];
  confidence: number;
  warnings: string[];
}

const ignoredLabels = [
  "towell",
  "integraq",
  "elaboró",
  "elaboro",
  "revisó",
  "reviso",
  "aprobó",
  "aprobo",
  "autorizó",
  "autorizo",
  "firma",
  "página",
  "pagina",
  "revisión",
  "revision",
  "fecha de emisión",
  "fecha de emision",
];

export function interpretExcelGrid({
  sourceName,
  sheetName,
  grid,
}: {
  sourceName: string;
  sheetName: string;
  grid: string[][];
}): FormImportDraft {
  const populated = grid
    .flat()
    .map(normalizeText)
    .filter(Boolean);
  const registrationNumber =
    populated
      .map((value) => value.match(/\bF-[A-ZÁÉÍÓÚÑ]{1,5}-\d{1,4}\b/i)?.[0])
      .find(Boolean)
      ?.toLocaleUpperCase("es-MX") ?? buildRegistrationNumber(sourceName);
  const name = findLikelyTitle(populated, registrationNumber, sourceName);
  const headerLabels = findLikelyHeaderRow(grid);
  const candidates = headerLabels.length >= 3
    ? headerLabels
    : populated.filter((value) => isFieldCandidate(value, name, registrationNumber));
  const fields = uniqueLabels(candidates)
    .slice(0, 18)
    .map((label, index) => buildImportedField(label, index));
  const normalizedFields = fields.length >= 2
    ? fields
    : [
        { id: "fecha", label: "Fecha", type: "date" as const, required: true },
        { id: "resultado", label: "Resultado", type: "select" as const, required: true, options: ["Conforme", "No conforme"] },
        { id: "observaciones", label: "Observaciones", type: "textarea" as const, required: false },
      ];
  const confidence = Math.min(
    0.96,
    0.45 + (registrationNumber ? 0.12 : 0) + Math.min(normalizedFields.length, 8) * 0.045,
  );
  const warnings = [
    ...(headerLabels.length >= 3
      ? ["Los campos se interpretaron desde la fila principal de encabezados."]
      : ["Los campos se interpretaron desde etiquetas distribuidas en la hoja."]),
    ...(fields.length < 2
      ? ["La hoja no contenía suficientes etiquetas; se agregó una estructura mínima editable."]
      : []),
  ];

  return {
    sourceType: "excel",
    sourceName,
    sheetName,
    registrationNumber,
    name,
    fields: normalizedFields,
    confidence,
    warnings,
  };
}

export function normalizeFormImportDraft(
  value: unknown,
  sourceName: string,
  sourceType: FormImportSource,
): FormImportDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<FormImportDraft>;
  if (!Array.isArray(candidate.fields)) return null;
  const fields = candidate.fields
    .map((field, index) => normalizeField(field, index))
    .filter((field): field is AppFormField => Boolean(field));
  if (!fields.length) return null;
  return {
    sourceType,
    sourceName,
    sheetName: typeof candidate.sheetName === "string" ? candidate.sheetName : undefined,
    registrationNumber:
      typeof candidate.registrationNumber === "string" && candidate.registrationNumber.trim()
        ? candidate.registrationNumber.trim().toLocaleUpperCase("es-MX")
        : buildRegistrationNumber(sourceName),
    name:
      typeof candidate.name === "string" && candidate.name.trim()
        ? candidate.name.trim()
        : fileNameToTitle(sourceName),
    fields,
    confidence:
      typeof candidate.confidence === "number"
        ? Math.max(0, Math.min(1, candidate.confidence))
        : 0.75,
    warnings: Array.isArray(candidate.warnings)
      ? candidate.warnings.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function findLikelyHeaderRow(grid: string[][]) {
  return grid
    .map((row, index) => ({
      index,
      values: uniqueLabels(row.map(normalizeText).filter(Boolean)),
    }))
    .filter(({ values }) => values.length >= 3 && values.length <= 14)
    .map((row) => ({
      ...row,
      score:
        row.values.filter((value) => isShortLabel(value)).length +
        Math.min(grid[row.index + 1]?.filter((value) => normalizeText(value)).length ?? 0, 4),
    }))
    .sort((left, right) => right.score - left.score)[0]?.values
    .filter((value) => !isIgnored(value)) ?? [];
}

function findLikelyTitle(
  values: string[],
  registrationNumber: string,
  sourceName: string,
) {
  return (
    values
      .slice(0, 30)
      .filter((value) =>
        value !== registrationNumber &&
        value.length >= 8 &&
        value.length <= 110 &&
        !isIgnored(value) &&
        !/^formato$/i.test(value) &&
        !/\b(rev\.?|versión|version|código|codigo)\b/i.test(value),
      )
      .sort((left, right) => right.length - left.length)[0] ??
    fileNameToTitle(sourceName)
  );
}

function isFieldCandidate(value: string, title: string, code: string) {
  return (
    value !== title &&
    value !== code &&
    value.length >= 2 &&
    value.length <= 62 &&
    isShortLabel(value) &&
    !isIgnored(value) &&
    !/^\d+(?:[.,]\d+)?$/.test(value) &&
    !/^https?:/i.test(value) &&
    !/@/.test(value)
  );
}

function isShortLabel(value: string) {
  return value.split(/\s+/).length <= 8 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(value);
}

function isIgnored(value: string) {
  const normalized = value.toLocaleLowerCase("es-MX").replace(/[:.]$/, "").trim();
  return ignoredLabels.some((label) => normalized === label || normalized.startsWith(`${label} `));
}

function uniqueLabels(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase("es-MX").replace(/[:*]$/, "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildImportedField(label: string, index: number): AppFormField {
  const cleanLabel = label.replace(/[:*]+$/, "").trim();
  const type = inferFieldType(cleanLabel);
  return {
    id: buildFieldId(cleanLabel, index),
    label: cleanLabel,
    type,
    required: index < 5,
    ...(type === "select" ? { options: inferOptions(cleanLabel) } : {}),
    ...(type === "number" && /porcentaje|%/i.test(cleanLabel) ? { unit: "%" } : {}),
  };
}

function inferFieldType(label: string): AppFormFieldType {
  if (/fecha|día|dia/i.test(label)) return "date";
  if (/cantidad|total|porcentaje|calificación|calificacion|peso|medida|metros|piezas|número|numero|importe|costo/i.test(label)) return "number";
  if (/observa|descrip|coment|detalle|causa|acción|accion|nota/i.test(label)) return "textarea";
  if (/resultado|estado|estatus|tipo|turno|conforme|aprobado|cumple/i.test(label)) return "select";
  return "text";
}

function inferOptions(label: string) {
  if (/estado|estatus/i.test(label)) return ["Abierto", "En seguimiento", "Cerrado"];
  if (/turno/i.test(label)) return ["1", "2", "3"];
  if (/aprobado/i.test(label)) return ["Aprobado", "Rechazado"];
  if (/cumple|conforme|resultado/i.test(label)) return ["Conforme", "No conforme"];
  return ["Opción 1", "Opción 2"];
}

function normalizeField(value: unknown, index: number): AppFormField | null {
  if (!value || typeof value !== "object") return null;
  const field = value as Partial<AppFormField>;
  if (typeof field.label !== "string" || !field.label.trim()) return null;
  const validTypes: AppFormFieldType[] = ["text", "number", "date", "select", "textarea"];
  const type = validTypes.includes(field.type as AppFormFieldType)
    ? (field.type as AppFormFieldType)
    : inferFieldType(field.label);
  return {
    id:
      typeof field.id === "string" && field.id.trim()
        ? field.id.trim()
        : buildFieldId(field.label, index),
    label: field.label.trim(),
    type,
    required: field.required !== false,
    ...(type === "select"
      ? {
          options:
            Array.isArray(field.options) && field.options.length
              ? field.options.filter((item): item is string => typeof item === "string")
              : inferOptions(field.label),
        }
      : {}),
    ...(type === "number" && typeof field.unit === "string" ? { unit: field.unit } : {}),
  };
}

function buildFieldId(label: string, index: number) {
  const id = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9]+(.)/g, (_, character: string) => character.toLocaleUpperCase("es-MX"))
    .replace(/[^a-zA-Z0-9]/g, "")
    .replace(/^\d+/, "");
  return id || `campo${index + 1}`;
}

function buildRegistrationNumber(sourceName: string) {
  const match = sourceName.match(/F[-_ ]([A-ZÁÉÍÓÚÑ]{1,5})[-_ ]?(\d{1,4})/i);
  return match
    ? `F-${match[1].toLocaleUpperCase("es-MX")}-${match[2]}`
    : "F-PENDIENTE";
}

function fileNameToTitle(sourceName: string) {
  return sourceName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Formulario importado";
}

function normalizeText(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
