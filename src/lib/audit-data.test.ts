import { describe, expect, it } from "vitest";

import {
  createAuditOccurrence,
  determineInitialAuditStatus,
  emptyAuditDraft,
  findPossibleDuplicates,
  initialAuditOccurrences,
  nextAuditCode,
  normalizeAuditRules,
  validateAuditDraft,
} from "./audit-data";

describe("audit occurrence rules", () => {
  it("forces customer audits to notice origin without recurrence", () => {
    const normalized = normalizeAuditRules({
      ...emptyAuditDraft(),
      auditType: "customer",
      origin: "recurrence",
      recurrence: "yes",
    });
    expect(normalized.origin).toBe("notice");
    expect(normalized.recurrence).toBe("no");
    expect(normalized.entityKind).toBe("customer");
  });

  it("requires confirmation fields but allows incomplete drafts", () => {
    const draft = emptyAuditDraft();
    expect(validateAuditDraft(draft, false)).toEqual({});
    expect(validateAuditDraft(draft, true)).toMatchObject({
      auditType: expect.any(String),
      responsibleUserId: expect.any(String),
      processIds: expect.any(String),
    });
  });

  it("derives the initial schedule status", () => {
    expect(determineInitialAuditStatus({ ...emptyAuditDraft(), scheduleType: "pending" }, true)).toBe("pending_schedule");
    expect(determineInitialAuditStatus({ ...emptyAuditDraft(), scheduleType: "window", windowStart: "2026-09-01", windowEnd: "2026-09-30" }, true, "2026-09-14")).toBe("window_open");
    expect(determineInitialAuditStatus(emptyAuditDraft(), false)).toBe("draft");
  });

  it("generates a unique yearly audit code", () => {
    expect(nextAuditCode(initialAuditOccurrences, 2026)).toBe("AUD-2026-0039");
  });

  it("detects matching customer, standard and overlapping dates", () => {
    const draft = {
      ...emptyAuditDraft(),
      auditType: "customer" as const,
      customerId: "walmart",
      standards: ["FCCA"],
      scheduleType: "range" as const,
      startDate: "2026-11-13",
      endDate: "2026-11-14",
    };
    expect(findPossibleDuplicates(draft, initialAuditOccurrences).map((audit) => audit.code)).toContain("AUD-2026-0037");
  });

  it("creates an immutable occurrence snapshot", () => {
    const occurrence = createAuditOccurrence({ ...emptyAuditDraft(), title: "Prueba" }, [], "Administrador", false, new Date("2026-09-14T12:00:00Z"));
    expect(occurrence).toMatchObject({ code: "AUD-2026-0001", status: "draft", createdBy: "Administrador" });
  });
});
