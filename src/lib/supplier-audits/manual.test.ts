import { describe, expect, it } from "vitest";
import { checkManualReferences, emptyManualRecord, manualCommand, parseManualRecord, type ManualAuditRecord } from "./manual";
import type { SupplierAuditFile } from "./model";
const id = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
const action = () => ({ id, description: "Corregir defecto documentado", responsibleName: "Responsable QA", commitmentDate: "2026-12-03", status: "pending" as const, completedDate: null, evidenceFileIds: [] });
const command = (record = emptyManualRecord()) => ({ revision: 1, requestId: id, reason: "Captura documental verificada", confirmed: true, record });
describe("manual supplier audit contract", () => {
  it("accepts an incomplete internal file without inventing a score, date or classification", () => expect(parseManualRecord(emptyManualRecord())).toEqual(emptyManualRecord()));
  it.each(["manufacturer", "distributor", "service"])("accepts explicit %s classification without changing methodology", classification => expect(parseManualRecord({ ...emptyManualRecord(), classification }).methodology).toBeNull());
  it("does not infer classification from names or other unknown fields", () => expect(() => parseManualRecord({ ...emptyManualRecord(), supplierName: "Manufacturer QA" })).toThrow(/campos/));
  it.each(["manufacturers", "distributors", "unknown", ""])("rejects unsupported classification %s", classification => expect(() => parseManualRecord({ ...emptyManualRecord(), classification })).toThrow());
  it.each(["V1", "V2"])("retains %s and the exact stored score without rubric conversion", methodology => {
    const record = parseManualRecord({ ...emptyManualRecord(), methodology, score: { value: 99.1667, sourceFileId: id, reference: "Portada, resultado final", verified: true } });
    expect(record.score?.value).toBe(99.1667); expect(record.methodology).toBe(methodology); expect(record).not.toHaveProperty("rubric_scores");
  });
  it.each([false, null, "true"])("rejects score without actual confirmation %s", verified => expect(() => parseManualRecord({ ...emptyManualRecord(), methodology: "V1", score: { value: 90, sourceFileId: id, reference: "Página 2", verified } })).toThrow());
  it.each([-1, 101, NaN, Infinity, "99"])("rejects invalid score %s", value => expect(() => parseManualRecord({ ...emptyManualRecord(), methodology: "V2", score: { value, sourceFileId: id, reference: "Página 2", verified: true } })).toThrow());
  it("does not infer closed status from a passed commitment date", () => expect(parseManualRecord({ ...emptyManualRecord(), actions: [action()] }).actions[0].status).toBe("pending"));
  it("allows a documented closed status with unknown actual date without inventing one", () => expect(parseManualRecord({ ...emptyManualRecord(), actions: [{ ...action(), status: "closed" }] }).actions[0].completedDate).toBeNull());
  it("requires explicit closure before recording an actual conclusion", () => expect(() => parseManualRecord({ ...emptyManualRecord(), actions: [{ ...action(), completedDate: "2026-12-02" }] })).toThrow(/no se cierra/));
  it.each(["description", "responsibleName", "commitmentDate"])("requires action field %s", field => expect(() => parseManualRecord({ ...emptyManualRecord(), actions: [{ ...action(), [field]: "" }] })).toThrow());
  it("rejects duplicate action identities", () => expect(() => parseManualRecord({ ...emptyManualRecord(), actions: [action(), action()] })).toThrow(/duplicar/));
  it.each(["2026-02-30", "2026-13-01", "19/11/2025"])("rejects invalid date %s", auditDate => expect(() => parseManualRecord({ ...emptyManualRecord(), auditDate })).toThrow());
  it("requires a classification before portal publication", () => expect(() => parseManualRecord({ ...emptyManualRecord(), portalVisible: true })).toThrow(/clasificación/));
  it("requires approval of each evidence shared with the supplier", () => expect(() => parseManualRecord({ ...emptyManualRecord(), classification: "service", portalVisible: true, actions: [{ ...action(), evidenceFileIds: [id] }] })).toThrow(/evidencias/));
  it("permits several approved plans without making copies or discarding historical versions", () => expect(parseManualRecord({ ...emptyManualRecord(), approvedFileIds: [id, second] }).approvedFileIds).toEqual([id, second]));
  it("requires source approval for a public score", () => expect(() => parseManualRecord({ ...emptyManualRecord(), classification: "manufacturer", portalVisible: true, methodology: "V1", score: { value: 99.1667, sourceFileId: id, reference: "Página 1", verified: true } })).toThrow(/documento/));
  it.each([{ revision: 0 }, { reason: "" }, { confirmed: false }, { requestId: "another-id" }, { supplierId: id }])("rejects manipulated command %j", patch => expect(() => manualCommand({ ...command(), ...patch })).toThrow());
  it("rejects file IDs from another audit", () => expect(() => checkManualReferences({ ...emptyManualRecord(), approvedFileIds: [id] }, [])).toThrow(/pertenecer/));
  it("requires a report, not just a plan, as grade evidence", () => {
    const record: ManualAuditRecord = { ...emptyManualRecord(), methodology: "V1", score: { value: 0, sourceFileId: id, reference: "Page 2", verified: true } };
    expect(() => checkManualReferences(record, [{ id, resource_type: "supplier_audit_action_plan" } as SupplierAuditFile])).toThrow(/informe/);
    expect(() => checkManualReferences(record, [{ id, resource_type: "supplier_audit_report" } as SupplierAuditFile])).not.toThrow();
  });
});


describe("SQL contract boundary regressions", () => {
  const mixed = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
  it("normalizes UUIDs once before SQL canonical receipts and references", () => {
    const record = { ...emptyManualRecord(), classification: "manufacturer", portalVisible: true, methodology: "V1", approvedFileIds: [mixed.toUpperCase()], score: { value: 99.1667, sourceFileId: mixed.toUpperCase(), reference: "Original", verified: true }, actions: [{ ...action(), id: mixed.toUpperCase(), evidenceFileIds: [mixed.toUpperCase()] }] };
    const parsed = manualCommand({ ...command(), requestId: mixed.toUpperCase(), record });
    expect(parsed.requestId).toBe(mixed); expect(parsed.record.score?.sourceFileId).toBe(mixed);
    expect(parsed.record.actions[0].id).toBe(mixed); expect(parsed.record.actions[0].evidenceFileIds).toEqual([mixed]); expect(parsed.record.approvedFileIds).toEqual([mixed]);
  });
  it("rejects file aliases that are the same UUID with a different case", () => expect(() => parseManualRecord({ ...emptyManualRecord(), approvedFileIds: [mixed, mixed.toUpperCase()] })).toThrow(/duplicados/));
  it("rejects action aliases before SQL unique identity validation", () => expect(() => parseManualRecord({ ...emptyManualRecord(), actions: [{ ...action(), id: mixed }, { ...action(), id: mixed.toUpperCase() }] })).toThrow(/duplicar/));
  it.each(["1999-12-31", "2201-01-01"])("rejects date outside the SQL range: %s", auditDate => expect(() => parseManualRecord({ ...emptyManualRecord(), auditDate })).toThrow());
  it.each(["2000-01-01", "2200-12-31"])("retains the date boundary without changing it: %s", auditDate => expect(parseManualRecord({ ...emptyManualRecord(), auditDate }).auditDate).toBe(auditDate));
  it.each([{ classification: ["manufacturer"] }, { methodology: ["V1"] }, { actions: [{ ...action(), status: ["closed"] }] }])("rejects a coerced string that SQL would reject: %j", patch => expect(() => parseManualRecord({ ...emptyManualRecord(), ...patch })).toThrow());
  it.each([0, 2147483647, 1.5])("rejects a revision that cannot increment safely: %s", revision => expect(() => manualCommand({ ...command(), revision })).toThrow());
});
