import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), workspace: vi.fn(), event: vi.fn(), settings: vi.fn(), suppliers: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supplier-audits/server", async () => {
 const actual = await vi.importActual<typeof import("./server")>("./server");
 return { ...actual, auditContext: mocks.context, loadAuditWorkspace: mocks.workspace, auditEvent: mocks.event, auditSettings: mocks.settings, auditSuppliers: mocks.suppliers };
});
vi.mock("server-only", () => ({}));
import { GET, POST } from "@/app/api/suppliers/audits/route";
import { GET as fileGET } from "@/app/api/suppliers/audits/[eventId]/files/[fileId]/route";
import { SupplierAuditError } from "./server";
const request = (body: object) => new Request("https://integraq.test/api/suppliers/audits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
describe("supplier audit API authorization", () => {
 beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: "event-1", error: null }); mocks.context.mockImplementation(async (mode = "view") => { if (mode !== "view") throw new SupplierAuditError("Inspector required", 403); return { organizationId: "org-1", administrator: false, canManage: false, supabase: { rpc: mocks.rpc } }; }); mocks.workspace.mockResolvedValue({ events: [] }); });
 it("authorized reader can view but cannot create reschedule cancel or finalize by direct requests", async () => {
  expect((await GET()).status).toBe(200);
  for (const state of ["scheduled", "rescheduled", "cancelled"]) expect((await POST(request({ command: "save", id: "event-1", reason: "Unauthorized request", payload: { state } }))).status).toBe(403);
  expect((await POST(request({ command: "result", id: "event-1", reason: "Unauthorized result" }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("unassigned administrator cannot manage just by knowing the event ID", async () => { mocks.context.mockRejectedValue(new SupplierAuditError("Inspector required", 403)); expect((await POST(request({ command: "save", id: "known-id" }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it.each(["Customer A", "Customer B", "Supplier A", "Supplier B", "Inactive user"])("%s cannot read internal audits or their files", async () => { mocks.context.mockRejectedValue(new SupplierAuditError("Denied", 403)); expect((await GET()).status).toBe(403); expect((await fileGET(new Request("https://integraq.test/file"), { params: Promise.resolve({ eventId: "event-1", fileId: "file-1" }) })).status).toBe(403); expect(mocks.workspace).not.toHaveBeenCalled(); });
 it("inspector scheduling uses identity-scoped RPC and passes actual version for concurrency", async () => {
  mocks.context.mockResolvedValue({ organizationId: "org-1", canManage: true, administrator: false, supabase: { rpc: mocks.rpc } });
  const payload = { year: 2026, month: 11, precision: "date", plannedDate: "2026-11-12", supplierId: "supplier-1", state: "rescheduled" };
  expect((await POST(request({ command: "save", id: "event-1", revision: 3, reason: "Supplier requested change", payload }))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("iq_supplier_audit_save", expect.objectContaining({ p_id: "event-1", p_expected_revision: 3, p_payload: payload }));
 });
 it("server errors do not report false success", async () => { mocks.context.mockResolvedValue({ canManage: true, supabase: { rpc: mocks.rpc } }); mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "AUDIT_CONFLICT" } }); expect((await POST(request({ command: "save", id: "event-1", revision: 1, reason: "Synthetic reason", payload: { year: 2026, month: 11, precision: "month" } }))).status).toBe(409); });
 it("rejects missing reason or invalid date before any write", async () => { mocks.context.mockResolvedValue({ canManage: true, supabase: { rpc: mocks.rpc } }); expect((await POST(request({ command: "save", id: "event-1", payload: {} }))).status).toBe(400); expect((await POST(request({ command: "save", payload: { year: 2026, month: 2, precision: "date", plannedDate: "2026-02-30" } }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it("view-only users cannot modify supplier contacts", async () => { expect((await POST(request({ command: "contacts", id: "supplier-1", reason: "Unauthorized contact edit" }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
});
