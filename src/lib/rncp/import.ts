import * as XLSX from "xlsx";
import { RNCP_SOURCE_COUNT, RNCP_SOURCE_SHA256 } from "./model";
import { normalizeText } from "./analytics";

export interface HistoricalRncpRow {
  row: number; sequence: number; folio: string; reportDate: string; material: string; supplierName: string;
  supplierCode: string; defect: string; actionType: string; historicalStatus: string; original: Array<string | number | boolean | null>;
}
export interface SupplierIdentity { id: string; code: string; name: string; active: boolean; }
export function canonicalSupplierCode(value: string) {
  const code = value.trim().toUpperCase();
  return /^(?:PR)?0*\d+$/.test(code) ? code.replace(/^PR/, "").replace(/^0+(?=\d)/, "") : code;
}
export function reconcileSupplier(row: Pick<HistoricalRncpRow, "supplierCode" | "supplierName">, suppliers: SupplierIdentity[]) {
  const byCode = suppliers.filter(s => canonicalSupplierCode(s.code) === canonicalSupplierCode(row.supplierCode));
  if (byCode.length === 1 && row.supplierCode.trim()) return { supplierId: byCode[0].id, method: "unique_official_code", pending: false };
  if (byCode.length > 1) return { supplierId: null, method: "ambiguous_code", pending: true };
  const byName = suppliers.filter(s => normalizeText(s.name) === normalizeText(row.supplierName));
  if (byName.length === 1) return { supplierId: byName[0].id, method: "unique_exact_name", pending: false };
  return { supplierId: null, method: byName.length > 1 ? "ambiguous_name" : "not_found", pending: true };
}
export function parseHistoricalMatrix(bytes: Uint8Array, sha256: string, expectedCount = RNCP_SOURCE_COUNT, expectedSha = RNCP_SOURCE_SHA256): HistoricalRncpRow[] {
  if (sha256 !== expectedSha) throw new Error("El archivo no coincide con la fuente F-CA-24 verificada. Requiere revisión antes de importar.");
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const sheet = workbook.Sheets.MATRIZ;
  if (!sheet) throw new Error("Falta la hoja MATRIZ.");
  const headers = ["Folio RNCP", "Materia Prima", "Proveedor", "Número de Proveedor", "Descripción del defecto", "Acción", "Estatus"];
  headers.forEach((header, i) => { if (normalizeText(String(sheet[`${XLSX.utils.encode_col(i + 2)}5`]?.v ?? "")) !== normalizeText(header)) throw new Error("Las columnas de MATRIZ no corresponden al formato verificado."); });
  const rowNumbers = Object.keys(sheet).filter(k => /^C\d+$/.test(k) && /^RNCP\d+$/i.test(String(sheet[k].v).trim())).map(k => Number(k.slice(1))).filter(n => n > 5).sort((a, b) => a - b);
  const rows = rowNumbers.map(row => {
    const original = Array.from({ length: 9 }, (_, column) => sheet[XLSX.utils.encode_cell({ r: row - 1, c: column })]?.v ?? null) as HistoricalRncpRow["original"];
    const serial = original[1];
    if (typeof serial !== "number") throw new Error(`Fecha Excel no verificable en fila ${row}.`);
    const date = XLSX.SSF.parse_date_code(serial);
    if (!date || !date.y || !date.m || !date.d) throw new Error(`Fecha inválida en fila ${row}.`);
    const text = (i: number) => String(original[i] ?? "").trim();
    if (!text(4) || !text(6) || !["Cerrado", "Tarde", "En Proceso"].includes(text(8))) throw new Error(`Datos históricos incompletos en fila ${row}.`);
    return { row, sequence: Number(original[0]), folio: text(2), reportDate: `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`,
      material: text(3), supplierName: text(4), supplierCode: text(5), defect: text(6), actionType: text(7), historicalStatus: text(8), original };
  });
  if (rows.length !== expectedCount) throw new Error(`La matriz tiene ${rows.length} RNCP; se esperaban ${expectedCount}. No se importó ningún registro.`);
  if (new Set(rows.map(r => r.folio.toUpperCase())).size !== rows.length) throw new Error("La matriz contiene folios duplicados.");
  return rows;
}
