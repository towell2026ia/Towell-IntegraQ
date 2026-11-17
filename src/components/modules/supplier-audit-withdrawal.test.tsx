import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SupplierAuditCalendar, SupplierAuditDialog } from "./supplier-audit-calendar";
import { SupplierAuditWithdrawal } from "./supplier-audit-withdrawal";
import type { AuditWorkspace, SupplierAudit } from "@/lib/supplier-audits/model";
vi.mock("./document-preview-viewer", () => ({ DocumentPreviewViewer: () => null }));
const event = { id: "11111111-1111-4111-8111-111111111111", organization_id: "org-A", supplier_id: "supplier-A", calendar_year: 2026, calendar_month: 11, date_precision: "date", planned_date: "2026-11-10", actual_date: "2026-11-10", state: "completed", revision: 4, withdrawn_at: "2026-11-10T12:00:00Z", withdrawn_by: "admin-A", withdrawal_reason: "Registro duplicado" } as SupplierAudit;
const data: AuditWorkspace = { canManage: true, administrator: true, withdrawalVersion: 1, events: [event], results: [{ id: "result-A", audit_event_id: event.id, questionnaire: "distributors", rubric_scores: {}, score: 88.25, assessment_date: "2026-11-10", evaluator_name: "Auditor QA", classification: null, observations: null, findings: null, audit_report_file_id: "file-A", action_plan_file_id: null }], suppliers: [], history: [], files: [{ id: "file-A", resource_id: event.id, resource_type: "supplier_audit_report", original_name: "Original-QA.pdf", version: 1, is_current: true, created_at: "2026-11-10T12:00:00Z", size_bytes: 120 }] };
const directory = { data, loading: false, error: "", refresh: async () => {} };
describe("withdrawal presentation and history", () => {
 it.each([{ administrator: false }, { canManage: false }, { withdrawalVersion: undefined }])("does not render administrative action without permission/capability %j", flags => expect(renderToStaticMarkup(createElement(SupplierAuditWithdrawal, { event, data: { ...data, ...flags }, onChanged: directory.refresh }))).toBe(""));
 it("retired detail retains score, original state and PDF consultation but blocks all editing", () => {
  const html = renderToStaticMarkup(createElement(SupplierAuditDialog, { directory, focus: { id: event.id, year: 2026, month: 11 }, onClose: vi.fn() }));
  expect(html).toContain("Retirada de programación"); expect(html).toContain("Finalizada"); expect(html).toContain("88.25"); expect(html).toContain("Original-QA.pdf"); expect(html).toContain("Descargar"); expect(html).toContain("Restaurar programación"); expect(html).toContain("Registro duplicado");
  expect(html).not.toMatch(/Gestionar agenda|Corregir evaluación con trazabilidad|Capturar calificaciones|type="file"|Adjuntar PDF/);
 });
 it("calendar operational cards exclude retired events without losing historical availability", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-10T18:00:00Z"));
  try { const html = renderToStaticMarkup(createElement(SupplierAuditCalendar, { directory, onOpen: vi.fn() })); expect(html).toContain("Noviembre 2026, 0 auditorías"); expect(html).toContain("Retiradas de programación (1)"); } finally { vi.useRealTimers(); }
 });
 it("cancelled events still identify as cancelled and offer retirement as a separate action", () => {
  const cancelled = { ...event, state: "cancelled" as const, withdrawn_at: null, withdrawn_by: null, withdrawal_reason: null };
  const html = renderToStaticMarkup(createElement(SupplierAuditDialog, { directory: { ...directory, data: { ...data, events: [cancelled] } }, focus: { id: event.id, year: 2026, month: 11 }, onClose: vi.fn() }));
  expect(html).toContain("Cancelada"); expect(html).toContain("Retirar de programación"); expect(html).not.toContain("Restaurar programación");
 });
});
