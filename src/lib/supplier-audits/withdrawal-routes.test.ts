import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), event: vi.fn(), rpc: vi.fn(), storage: vi.fn(), suppliers: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supplier-audits/server", async () => ({ ...await vi.importActual<typeof import("./server")>("./server"), auditContext: mocks.context, auditEvent: mocks.event, auditSuppliers: mocks.suppliers }));
import { POST } from "@/app/api/suppliers/audits/route";
import { POST as upload } from "@/app/api/suppliers/audits/[eventId]/files/route";
import { GET as download } from "@/app/api/suppliers/audits/[eventId]/files/[fileId]/route";
import { SupplierAuditError } from "./server";
const id = "11111111-1111-4111-8111-111111111111";
const body = { command: "withdraw", id, revision: 4, reason: "Captura duplicada verificada" };
const request = (value: unknown) => new Request("http://localhost/api/suppliers/audits", { method: "POST", body: JSON.stringify(value) });
const context = () => ({ organizationId: "org-A", administrator: true, canManage: true, withdrawalVersion: 1, supabase: { rpc: mocks.rpc }, admin: { storage: mocks.storage } });
describe("administrative withdrawal API", () => {
 beforeEach(() => { vi.resetAllMocks(); mocks.context.mockResolvedValue(context()); mocks.rpc.mockResolvedValue({ data: { id, revision: 5, withdrawn_at: "2026-11-10T12:00:00Z" }, error: null }); mocks.event.mockResolvedValue({ id, supplier_id: "supplier-A", organization_id: "org-A", revision: 4, withdrawn_at: "2026-11-10T12:00:00Z" }); });
 it("retires through the session RPC with revision and no client actor or organization", async () => {
  const response = await POST(request({ ...body, actor: "forged", organization: "org-B" })); expect(response.status).toBe(200);
  expect(mocks.context).toHaveBeenCalledWith("admin"); expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("iq_supplier_audit_set_withdrawn", { p_event: id, p_expected_revision: 4, p_withdrawn: true, p_reason: body.reason });
 });
 it("restores the same ID and requires the new revision", async () => {
  mocks.rpc.mockResolvedValue({ data: { id, revision: 6, withdrawn_at: null }, error: null });
  const response = await POST(request({ ...body, command: "restore", revision: 5 })); expect(response.status).toBe(200); expect(await response.json()).toEqual({ saved: true, id, revision: 6, withdrawn_at: null });
  expect(mocks.rpc).toHaveBeenCalledWith("iq_supplier_audit_set_withdrawn", expect.objectContaining({ p_withdrawn: false, p_expected_revision: 5 }));
 });
 it.each([{ administrator: false }, { canManage: false }])("rejects unauthorized context %j before any write", async flags => { mocks.context.mockResolvedValue({ ...context(), ...flags }); expect((await POST(request(body))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it.each([undefined, 0, 2])("fails closed before SQL capability %s", async withdrawalVersion => { mocks.context.mockResolvedValue({ ...context(), withdrawalVersion }); expect((await POST(request(body))).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it.each(["", "    ", "abc", "x".repeat(2001)])("requires a bounded reason before RPC", async reason => { expect((await POST(request({ ...body, reason }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it("blocks unauthenticated sessions", async () => { mocks.context.mockRejectedValue(new SupplierAuditError("Session missing", 401)); expect((await POST(request(body))).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it("propagates RPC cross-organization denial without returning data", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "AUDIT_ACCESS_DENIED" } }); const response = await POST(request(body)); expect(response.status).toBe(403); expect(await response.json()).not.toHaveProperty("saved"); });
 it("passes two identical concurrent requests without replay, respecting the RPC conflict", async () => {
  let revision = 4;
  mocks.rpc.mockImplementation(async (_name, args) => args.p_expected_revision !== revision ? { error: { code: "P0001", message: "AUDIT_CONFLICT" } } : { data: { id, revision: ++revision, withdrawn_at: "date" }, error: null });
  const results = await Promise.all([POST(request(body)), POST(request(body))]); expect(results.map(r => r.status)).toEqual([200, 409]); expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(revision).toBe(5);
 });
 it("lost response is not replayed; a stale retry returns conflict", async () => {
  mocks.rpc.mockRejectedValueOnce(new Error("Response lost after commit")).mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "AUDIT_CONFLICT" } });
  expect((await POST(request(body))).status).toBe(500); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect((await POST(request(body))).status).toBe(409); expect(mocks.rpc).toHaveBeenCalledTimes(2);
 });
 it.each([{ id: "other", revision: 5, withdrawn_at: "date" }, { id, revision: 4, withdrawn_at: "date" }, { id, revision: 5, withdrawn_at: null }, null])("never confirms a malformed RPC acknowledgement %j", async data => { mocks.rpc.mockResolvedValue({ data, error: null }); expect((await POST(request(body))).status).toBe(503); });
 it("blocks editing and results of retired events before RPC", async () => {
  expect((await POST(request({ ...body, command: "save", payload: { year: 2026, month: 11, precision: "month" } }))).status).toBe(409);
  expect((await POST(request({ ...body, command: "result", payload: { questionnaire: "distributors", scores: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i + 1), 90])), score: 90, evaluationDate: "2026-11-01", actualDate: "2026-11-01", reportId: "file", auditor: "Auditor QA" } }))).status).toBe(409);
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("rejects a file upload before reading its body or contacting Storage", async () => { const response = await upload(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ eventId: id }) }); expect(response.status).toBe(409); expect(mocks.storage).not.toHaveBeenCalled(); expect(mocks.suppliers).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it("preserves existing document access for a retired event in the same organization", async () => {
  const sign = vi.fn().mockResolvedValue({ data: { signedUrl: "http://localhost/private-original.pdf" }, error: null });
  const filters: unknown[] = []; const query = { select: vi.fn().mockReturnThis(), eq: vi.fn((key, value) => { filters.push([key, value]); return query; }), in: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { bucket_id: "integraq-private", object_path: "original.pdf", original_name: "Original.pdf", external_organization_id: "supplier-A" }, error: null }) };
  mocks.context.mockResolvedValue({ ...context(), admin: { from: vi.fn().mockReturnValue(query), storage: { from: () => ({ createSignedUrl: sign }) } } });
  const response = await download(new Request("http://localhost/?download=true"), { params: Promise.resolve({ eventId: id, fileId: "original" }) });
  expect(response.status).toBe(200); expect(sign).toHaveBeenCalledWith("original.pdf", 60, { download: "Original.pdf" }); expect(filters).toContainEqual(["workspace_id", "org-A"]); expect(filters).toContainEqual(["resource_id", id]);
 });
});
