import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseAuditProgram, matchAuditSupplier } from "./import";
import { monthDays, monthSummary, auditDayMatch, validateSchedule, validateScores, questionnaires, type SupplierAudit, AUDIT_PROGRAM_SHA, EVALUATION_TEMPLATE_SHA } from "./model";
function fixture() {
 const workbook = XLSX.utils.book_new();
 for (const [index, name] of ["2025 JUL-ENE", "2026 FEB-JUL", "2026 AGO-ENE"].entries()) {
  const sheet: XLSX.WorkSheet = { B9: { t: "s", v: "Proveedores" }, J11: { t: "s", v: "P" }, K11: { t: "s", v: "R" }, "!ref": "A1:AI60" };
  for (let i = 0; i < (index === 1 ? 8 : 7); i++) {
   const row = 12 + i * 3; sheet[`A${row}`] = { t: "n", v: i + 1 }; sheet[`B${row}`] = { t: "s", v: `Synthetic supplier ${i + 1}` }; sheet[`E${row}`] = { t: "s", v: "Synthetic criteria" }; sheet[`H${row}`] = { t: "s", v: "Synthetic auditor" };
   sheet[`X${row}`] = { t: "n", v: 46262 + i }; sheet[`Y${row}`] = i === 0 ? { t: "s", v: "Cancelada" } : i === 1 ? { t: "s", v: "PENDIENTE" } : { t: "n", v: 46264 + i };
  }
  XLSX.utils.book_append_sheet(workbook, sheet, name);
 }
 return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}
const event = (patch: Partial<SupplierAudit> = {}) => ({ date_precision: "date", planned_date: "2026-11-10", week_start: null, state: "scheduled", ...patch }) as SupplierAudit;
describe("supplier annual calendar and manual evaluation", () => {
 it("contains all real November days once and uses Monday first", () => { const dates = monthDays(2026, 11); expect(dates.filter(Boolean)).toHaveLength(30); expect(dates.slice(0, 6)).toEqual(Array(6).fill(null)); expect(new Set(dates.filter(Boolean)).size).toBe(30); });
 it("handles leap years and January without a hardcoded audit year", () => { expect(monthDays(2028, 2).filter(Boolean)).toHaveLength(29); expect(monthDays(2027, 1).filter(Boolean)[0]).toBe("2027-01-01"); });
 it("does not impose a four-audit monthly cap", () => expect(monthSummary(Array.from({ length: 9 }, () => event())).scheduled).toBe(9));
 it("counts statuses separately and finalized results as performed", () => expect(monthSummary([event(), event({ state: "confirmed" }), event({ state: "rescheduled" }), event({ state: "cancelled" }), event({ state: "pending" }), event({ state: "performed" }), event({ state: "completed" })])).toEqual({ scheduled: 3, performed: 2, cancelled: 1, pending: 1 }));
 it("week selections span seven actual dates without creating an exact date", () => { const e = event({ date_precision: "week", planned_date: null, week_start: "2026-11-09" }); expect(auditDayMatch(e, "2026-11-15")).toBe(true); expect(auditDayMatch(e, "2026-11-16")).toBe(false); });
 it("validates real calendar dates and selected month", () => { expect(() => validateSchedule({ year: 2026, month: 2, precision: "date", plannedDate: "2026-02-30" })).toThrow(); expect(() => validateSchedule({ year: 2026, month: 11, precision: "week", weekStart: "2026-12-01" })).toThrow(); expect(() => validateSchedule({ year: 2026, month: 11, precision: "month" })).not.toThrow(); });
 it.each(["manufacturers", "distributors"] as const)("requires every %s rubric and preserves manual final score including zero", q => { const scores = Object.fromEntries(questionnaires[q].map((_, i) => [String(i + 1), 0])); expect(() => validateScores(q, scores, 72.5)).not.toThrow(); expect(() => validateScores(q, scores, 0)).not.toThrow(); delete scores["1"]; expect(() => validateScores(q, scores, 100)).toThrow(); });
 it("rejects extra rubrics out-of-range values and empty final grades", () => { const scores = Object.fromEntries(questionnaires.distributors.map((_, i) => [String(i + 1), 90])); expect(() => validateScores("distributors", { ...scores, "9": 0 }, 90)).toThrow(); expect(() => validateScores("distributors", { ...scores, "1": 101 }, 90)).toThrow(); expect(() => validateScores("distributors", scores, "")).toThrow(); });
});
describe("controlled F-CA-58 historical parser", () => {
 it("imports all sheets and 22 positions with original P/R values", () => { const rows = parseAuditProgram(fixture(), "synthetic", "synthetic"); expect(rows).toHaveLength(22); expect(new Set(rows.map(r => `${r.sourceSheet}:${r.sourceRow}`)).size).toBe(22); expect(rows[0]).toMatchObject({ state: "cancelled", actualDate: null, sourceStatus: "Cancelada", sourcePayload: { plannedValue: 46262, actualValue: "Cancelada" } }); expect(rows[1]).toMatchObject({ state: "pending", actualDate: null }); expect(rows[2]).toMatchObject({ state: "performed" }); expect(rows[2].plannedDate).not.toBe(rows[2].actualDate); });
 it("does not treat a date R as a grade or a PDF", () => { const rows = parseAuditProgram(fixture(), "synthetic", "synthetic"); expect(rows[2]).not.toHaveProperty("score"); expect(rows[2]).not.toHaveProperty("fileId"); });
 it("rejects altered source before returning any events", () => expect(() => parseAuditProgram(fixture(), "wrong")).toThrow("cambió"));
 it("retains unmatched and ambiguous suppliers without guessed aliases", () => { expect(matchAuditSupplier("Anahuac (OE)", [{ id: "1", name: "Anahuac (Anillo)" }])).toBeNull(); expect(matchAuditSupplier("Supplier", [{ id: "1", name: "Supplier" }, { id: "2", name: "Supplier" }])).toBeNull(); expect(matchAuditSupplier("  SÍNTÉTICO  ", [{ id: "1", name: "Sintetico" }])).toBe("1"); });
});
const originalDirectory = process.env.SUPPLIER_AUDIT_REFERENCE_DIR;
it.skipIf(!originalDirectory)("verifies the original program and both F-CO-05 rubric lists without running macros", () => {
 const program = new Uint8Array(readFileSync(join(originalDirectory!, "F-CA-58_Programa de auditoría a Proveedores_V0.xlsx")));
 expect(createHash("sha256").update(program).digest("hex")).toBe(AUDIT_PROGRAM_SHA);
 const rows = parseAuditProgram(program, AUDIT_PROGRAM_SHA); expect(rows).toHaveLength(22);
 expect(rows.filter(r => r.state === "performed")).toHaveLength(14); expect(rows.filter(r => r.state === "cancelled")).toHaveLength(3); expect(rows.filter(r => r.state === "pending")).toHaveLength(5);
 const evaluationSource = readFileSync(join(originalDirectory!, "F-CO-05_Evaluación de proveedores_V2 (esp).xlsm"));
 expect(createHash("sha256").update(evaluationSource).digest("hex")).toBe(EVALUATION_TEMPLATE_SHA);
 const workbook = XLSX.read(evaluationSource, { type: "buffer" });
 const manufacturers = [10, 18, 25, 33, 41, 50, 57, 66, 74].map(r => workbook.Sheets.Manufacturers[`C${r}`].v);
 const distributors = [10, 18, 26, 34, 43, 51, 60, 68].map(r => workbook.Sheets["Distribuidores y Servicio"][`C${r}`].v);
 expect(manufacturers).toEqual([...questionnaires.manufacturers]); expect(distributors).toEqual([...questionnaires.distributors]);
 expect(workbook.Sheets.Manufacturers.O1.f).not.toContain("J74"); expect(workbook.Sheets["Distribuidores y Servicio"].P1.f).not.toContain("J68");
});
