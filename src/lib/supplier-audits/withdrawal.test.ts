import { describe, expect, it } from "vitest";
import { canWithdrawAudit, isAuditWithdrawn, isOperationalAssessment, withdrawalInput, withdrawalReason } from "./withdrawal";
import { auditDayMatch, monthSummary, type SupplierAudit } from "./model";
const id = "11111111-1111-4111-8111-111111111111";
const event = (state: SupplierAudit["state"], withdrawn = false) => ({ id, state, date_precision: "date", planned_date: "2026-11-10", withdrawn_at: withdrawn ? "2026-11-10T12:00:00Z" : null }) as SupplierAudit;
describe("withdrawal domain and operational counts", () => {
  it.each([{ administrator: false, canManage: true, withdrawalVersion: 1 }, { administrator: true, canManage: false, withdrawalVersion: 1 }, { administrator: true, canManage: true }, { administrator: true, canManage: true, withdrawalVersion: 2 }])("requires administrator, management and supported server capability: %j", context => expect(canWithdrawAudit(context)).toBe(false));
  it("allows a freshly authorized administrator with the supported contract", () => expect(canWithdrawAudit({ administrator: true, canManage: true, withdrawalVersion: 1 })).toBe(true));
  it.each([null, undefined, "", "    ", "\n\t\r   ", "abcd", "x".repeat(2001)])("rejects missing or invalid reason %j", reason => expect(() => withdrawalReason(reason)).toThrow());
  it("normalizes a real reason and accepts the maximum length", () => { expect(withdrawalReason("  Captura duplicada  ")).toBe("Captura duplicada"); expect(withdrawalReason("x".repeat(2000))).toHaveLength(2000); });
  it.each([0, -1, 1.5, "1", undefined, 2147483648])("rejects manipulated revisions %j", revision => expect(() => withdrawalInput({ id, revision, command: "withdraw", reason: "Error de captura" })).toThrow());
  it("uses only allowed fields and distinguishes restore from withdrawal", () => {
    expect(withdrawalInput({ id, revision: 2, command: "restore", reason: " Restauración verificada ", organizationId: "foreign", actorId: "forged", withdrawn: true })).toEqual({ id, revision: 2, withdrawn: false, reason: "Restauración verificada" });
    expect(() => withdrawalInput({ id: "not-a-uuid", revision: 2, command: "withdraw", reason: "Error de captura" })).toThrow();
  });
  it("excludes every retired state without modifying cancellation or input records", () => {
    const states = ["scheduled", "confirmed", "rescheduled", "pending", "cancelled", "performed", "completed"] as const;
    const events = [...states.map(s => event(s)), ...states.map(s => event(s, true))], before = JSON.stringify(events);
    expect(monthSummary(events)).toEqual({ scheduled: 3, pending: 1, cancelled: 1, performed: 2 }); expect(JSON.stringify(events)).toBe(before);
  });
  it("retired events cannot match a day, and the old schema remains readable", () => {
    expect(auditDayMatch(event("scheduled", true), "2026-11-10")).toBe(false);
    expect(auditDayMatch(event("cancelled"), "2026-11-10")).toBe(true);
    expect(isAuditWithdrawn({})).toBe(false);
  });
  it("secondary dashboard includes legacy assessments and excludes withdrawn or inaccessible parents", () => {
    expect(isOperationalAssessment({ audit_event_id: null, audit_event: null })).toBe(true);
    expect(isOperationalAssessment({ audit_event_id: id, audit_event: { id } })).toBe(true);
    expect(isOperationalAssessment({ audit_event_id: id, audit_event: { id, withdrawn_at: "date" } })).toBe(false);
    expect(isOperationalAssessment({ audit_event_id: id, audit_event: null })).toBe(false);
    expect(isOperationalAssessment({ audit_event_id: id, audit_event: { id: "other" } })).toBe(false);
  });
});
