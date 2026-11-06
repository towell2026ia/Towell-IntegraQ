import * as XLSX from "xlsx";
import { AUDIT_PROGRAM_SHA, type AuditState } from "./model";

export interface HistoricalAudit {
  supplierName: string; criteria: string; method: string; responsible: string; observations: string;
  year: number; month: number; plannedDate: string | null; actualDate: string | null; state: AuditState;
  sourceSheet: string; sourceRow: number; sourceColumn: string; sourceStatus: string | null; sourcePayload: Record<string, unknown>;
}
function excelDate(value: unknown) {
  if (typeof value !== "number") return null;
  const d = XLSX.SSF.parse_date_code(value);
  if (!d || d.y < 2000 || d.y > 2200) throw new Error("Fecha de Excel fuera del alcance verificado.");
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}
export function parseAuditProgram(bytes: Uint8Array, sha: string, requiredSha = AUDIT_PROGRAM_SHA, expectedCount = 22): HistoricalAudit[] {
  if (sha !== requiredSha) throw new Error("El archivo F-CA-58 cambió; requiere revisión antes de importar.");
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const sheets = ["2025 JUL-ENE", "2026 FEB-JUL", "2026 AGO-ENE"];
  const events: HistoricalAudit[] = [];
  for (const name of sheets) {
    const sheet = workbook.Sheets[name];
    if (!sheet || sheet.B9?.v !== "Proveedores" || sheet.J11?.v !== "P" || sheet.K11?.v !== "R") throw new Error("El programa no corresponde a la estructura F-CA-58 verificada.");
    const sourceRows = Object.keys(sheet).filter(k => /^A\d+$/.test(k) && Number(k.slice(1)) >= 12 && typeof sheet[k].v === "number" && typeof sheet[`B${k.slice(1)}`]?.v === "string").map(k => Number(k.slice(1))).sort((a, b) => a - b);
    const observationRow = Object.keys(sheet).find(k => /^A\d+$/.test(k) && String(sheet[k].v).trim() === "OBSERVACIONES");
    const observations = observationRow ? String(sheet[`A${Number(observationRow.slice(1)) + 1}`]?.v ?? "") : "";
    for (const row of sourceRows) {
      const raw = Array.from({ length: 35 }, (_, c) => sheet[XLSX.utils.encode_cell({ r: row - 1, c })]?.v ?? null);
      let found = false;
      for (let col = 9; col < 35; col += 2) {
        const p = raw[col], r = raw[col + 1];
        if ((p === null || p === "") && (r === null || r === "")) continue;
        found = true;
        const plannedDate = excelDate(p), actualDate = excelDate(r), anchor = plannedDate ?? actualDate;
        const sourceStatus = typeof r === "string" ? r : null;
        if (typeof p === "string" && p.trim()) throw new Error(`Fecha P no interpretable en ${name}, fila ${row}; no se importó nada.`);
        if (sourceStatus && !/^(cancelada|pendiente)$/i.test(sourceStatus.trim())) throw new Error(`Estado R no reconocido en ${name}, fila ${row}.`);
        const columnMonth = (col - 9) / 2 + 1;
        const year = anchor ? Number(anchor.slice(0, 4)) : Number(name.slice(0, 4)) + (columnMonth === 13 ? 1 : 0);
        const month = anchor ? Number(anchor.slice(5, 7)) : columnMonth === 13 ? 1 : columnMonth;
        events.push({ supplierName: String(raw[1]), criteria: String(raw[4] ?? ""), method: String(raw[5] ?? ""), responsible: String(raw[7] ?? ""), observations,
          year, month, plannedDate, actualDate, state: sourceStatus?.trim().toLowerCase() === "cancelada" ? "cancelled" : actualDate ? "performed" : "pending",
          sourceSheet: name, sourceRow: row, sourceColumn: XLSX.utils.encode_col(col), sourceStatus,
          sourcePayload: { sourceFile: "F-CA-58_Programa de auditoría a Proveedores_V0.xlsx", rowValues: raw, plannedValue: p, actualValue: r, monthHeader: sheet[XLSX.utils.encode_cell({ r: 8, c: col })]?.v ?? null,
            objective: sheet.C5?.v ?? null, scope: sheet.C7?.v ?? null, notes: Object.keys(sheet).filter(k => /^[AJ]\d+$/.test(k) && Number(k.replace(/\D/g, "")) > row + 1 && Number(k.replace(/\D/g, "")) >= Number(observationRow?.slice(1) ?? 1000)).sort().map(k => ({ cell: k, value: sheet[k].v })) } });
      }
      if (!found) throw new Error(`Proveedor sin fecha ni mes verificable en ${name}, fila ${row}.`);
    }
  }
  if (events.length !== expectedCount || new Set(events.map(e => `${e.sourceSheet}:${e.sourceRow}:${e.sourceColumn}`)).size !== events.length) throw new Error("El inventario no coincide con los 22 eventos oficiales; no se importó nada.");
  return events;
}
export function normalizeSupplierName(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase(); }
export function matchAuditSupplier(name: string, suppliers: Array<{ id: string; name: string }>) {
  const matches = suppliers.filter(s => normalizeSupplierName(s.name) === normalizeSupplierName(name));
  return matches.length === 1 ? matches[0].id : null;
}
