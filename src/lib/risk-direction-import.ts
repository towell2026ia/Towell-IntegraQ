import type { DirectionCandidate, DirectionCandidateKind } from "@/lib/risk-opportunity-data";

export type DirectionImportCell = string | number | boolean | Date | null | undefined;
type Cell = DirectionImportCell;

export type ImportedDirectionCandidate = Omit<DirectionCandidate, "id">;

const classificationAliases: Record<string, DirectionCandidateKind> = {
  actividad: "activity",
  control: "control",
  iniciativa: "initiative",
  objetivo: "objective",
  oportunidad: "opportunity",
  pendiente: "pending",
  riesgo: "risk",
  "resultado clave": "key_result",
  kr: "key_result",
};

function text(value: Cell) {
  if (value === null || value === undefined) return "";
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
}

function normalized(value: Cell) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, " ").trim();
}

function progress(value: Cell) {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1 ? value / 100 : value;
  const parsed = Number(text(value).replace("%", "").replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return text(value).includes("%") || parsed > 1 ? parsed / 100 : parsed;
}

function classification(value: Cell): DirectionCandidateKind {
  return classificationAliases[normalized(value)] ?? "pending";
}

function locate(headers: Cell[], aliases: string[]) {
  return headers.findIndex((value) => aliases.some((alias) => normalized(value).includes(alias)));
}

function cell(row: Cell[], index: number) {
  return index >= 0 ? text(row[index]) : "";
}

function standardRows(rows: Cell[][], headerIndex: number, sourceName: string): ImportedDirectionCandidate[] {
  const headers = rows[headerIndex] ?? [];
  const descriptionIndex = locate(headers, ["descripcion", "actividad", "riesgo oportunidad", "elemento"]);
  const responsibleIndex = locate(headers, ["responsable original", "responsable"]);
  const controlIndex = locate(headers, ["punto de control", "control"]);
  const roPrimaryIndex = locate(headers, ["r o 1", "tipo r o", "riesgo oportunidad"]);
  const roSecondaryIndex = locate(headers, ["r o 2", "segunda marca"]);
  const progressIndex = locate(headers, ["avance historico", "avance", "progreso"]);
  const processIndex = locate(headers, ["proceso responsable", "proceso"]);
  const ownerIndex = locate(headers, ["responsable confirmado", "dueno", "owner"]);
  const classificationIndex = locate(headers, ["clasificacion", "etapa", "tipo"]);

  return rows.slice(headerIndex + 1).flatMap((row, offset) => {
    const description = cell(row, descriptionIndex);
    if (!description) return [];
    const processMatch = cell(row, processIndex).toUpperCase().match(/P-?\d{1,2}/)?.[0]?.replace(/^P(\d)/, "P-$1");
    const itemClassification = classification(row[classificationIndex]);
    return [{
      sourceRow: headerIndex + offset + 2,
      description,
      responsibleLabel: cell(row, responsibleIndex),
      controlPoint: cell(row, controlIndex),
      roPrimary: cell(row, roPrimaryIndex),
      roSecondary: cell(row, roSecondaryIndex),
      historicalProgress: progress(row[progressIndex]),
      axisWeights: [],
      classification: itemClassification,
      processId: processMatch,
      ownerName: cell(row, ownerIndex) || undefined,
      reviewStatus: itemClassification === "pending" ? "pending" : "ready",
      sourceType: "file" as const,
      sourceName,
    }];
  });
}

function legacyRows(rows: Cell[][], sourceName: string): ImportedDirectionCandidate[] {
  return rows.flatMap((row, index) => {
    const description = text(row[16]);
    if (!description || normalized(description).includes("descripcion")) return [];
    return [{
      sourceRow: index + 1,
      description,
      responsibleLabel: text(row[12]),
      controlPoint: text(row[13]),
      roPrimary: text(row[14]),
      roSecondary: text(row[15]),
      historicalProgress: progress(row[18]),
      axisWeights: row.slice(0, 12).map((value) => typeof value === "number" || typeof value === "string" ? value : null),
      classification: "pending" as const,
      reviewStatus: "pending" as const,
      sourceType: "file" as const,
      sourceName,
    }];
  });
}

export function parseDirectionImportRows(rows: Cell[][], sourceName: string): ImportedDirectionCandidate[] {
  const headerIndex = rows.slice(0, 30).findIndex((row) => row.some((value) => ["descripcion", "actividad", "elemento"].includes(normalized(value))));
  if (headerIndex >= 0) return standardRows(rows, headerIndex, sourceName);
  return legacyRows(rows, sourceName);
}

export function directionCandidateFingerprint(item: Pick<DirectionCandidate, "description" | "responsibleLabel" | "controlPoint">) {
  return [item.description, item.responsibleLabel, item.controlPoint].map(normalized).join("|");
}
