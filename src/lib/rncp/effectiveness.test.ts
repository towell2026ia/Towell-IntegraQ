import { describe, expect, it } from "vitest";
import type { RncpReport } from "@/lib/rncp-data";
import { supplierRncpEffectiveness } from "./effectiveness";
const now = Date.parse("2026-11-07T18:00:00Z");
const historical = (id: string, historicalStatus = "Cerrado", patch: Partial<RncpReport> = {}): RncpReport => ({
  id, folio: id, supplierId: "a", origin: "historical", historicalStatus, status: "closed", late: false,
  portalVisible: false, createdAt: "2026-01-01", updatedAt: "2026-01-01", history: [], actions: [], ...patch,
});
const native = (patch: Partial<RncpReport> = {}) => historical("native", undefined, {
  origin: "native", historicalStatus: undefined, notifiedAt: "2026-10-01T18:00:00Z",
  responseDeadline: "2026-10-08T18:00:00Z", completeSubmittedAt: "2026-10-08T18:00:00Z",
  validatedAt: "2026-10-09T18:00:00Z", validationOutcome: "accepted", ...patch,
});
const calc = (rows: RncpReport[]) => supplierRncpEffectiveness(rows, "a", now);
describe("supplier RNCP effectiveness, separate from F-CO-05 scores", () => {
  it("calculates 75% from three original Cerrado and one Tarde", () => {
    const rows = [historical("1"), historical("2"), historical("3"), historical("4", "Tarde")];
    const before = JSON.stringify(rows);
    expect(calc(rows)).toMatchObject({ closed: 3, late: 1, evaluable: 4, percent: 75, nativeClosed: 0 });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("returns 100% without late records and null without evaluable RNCP", () => {
    expect(calc([historical("1")]).percent).toBe(100);
    expect(calc([]).percent).toBeNull();
    expect(calc([historical("1", "En Proceso")]).percent).toBeNull();
    expect(calc([historical("1", "Tarde")]).percent).toBe(0);
  });
  it("uses original historical categories even when mapped status and late disagree", () => {
    expect(calc([historical("1", "Tarde", { status: "closed", late: false }), historical("2", "Cerrado", { late: true })]))
      .toMatchObject({ closed: 1, late: 1, percent: 50 });
  });
  it("excludes retired records, drafts, in-process and unverified legacy categories", () => {
    expect(calc([historical("1", "Cerrado", { deletedAt: "2026-11-01" }), native({ status: "draft" }),
      native({ id: "2", status: "in_progress", late: true }), historical("3", "Cerrado", { origin: "legacy" }),
      historical("4", "cerrado")])).toMatchObject({ evaluable: 0, percent: null });
  });
  it("does not mix providers or change when unrelated scores are present", () => {
    expect(calc([historical("1"), historical("2", "Tarde", { supplierId: "b" })]).percent).toBe(100);
    const withScore = { ...historical("1"), auditScore: 20 };
    expect(calc([withScore]).percent).toBe(100);
  });
  it("uses a validated complete response at the deadline, ignoring the visual flag", () =>
    expect(calc([native({ late: true })])).toMatchObject({ nativeClosed: 1, nativeLate: 0, percent: 100 }));
  it("counts a closed native report with a late response only once as late", () =>
    expect(calc([native({ completeSubmittedAt: "2026-10-08T18:00:01Z", late: false })]))
      .toMatchObject({ closed: 0, late: 1, evaluable: 1, percent: 0 }));
  it.each([
    { completeSubmittedAt: undefined }, { validatedAt: undefined }, { responseDeadline: undefined },
    { notifiedAt: undefined }, { completeSubmittedAt: "invalid" }, { responseDeadline: "2026-10-08" },
    { completeSubmittedAt: "2026-09-01T18:00:00Z" }, { validatedAt: "2026-12-01T18:00:00Z" },
    { validationOutcome: "pending" as const }, { validationOutcome: "rejected" as const },
  ])("excludes unverifiable native response dates: %j", patch => expect(calc([native(patch)]).percent).toBeNull());
  it("does not double-count duplicated IDs and excludes conflicting duplicates", () => {
    expect(calc([historical("1"), historical("1")]).evaluable).toBe(1);
    expect(calc([historical("1"), historical("1", "Tarde")]).percent).toBeNull();
  });
});
