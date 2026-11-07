import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), workspace: vi.fn(), event: vi.fn(), suppliers: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supplier-audits/server", async () => {
 const actual = await vi.importActual<typeof import("./server")>("./server");
 return { ...actual, auditContext: mocks.context, loadAuditWorkspace: mocks.workspace, auditEvent: mocks.event, auditSuppliers: mocks.suppliers };
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
 it("administrator without explicit editing permission cannot manage just by knowing the event ID", async () => { mocks.context.mockRejectedValue(new SupplierAuditError("Inspector required", 403)); expect((await POST(request({ command: "save", id: "known-id" }))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it("removed calendar configuration cannot grant permissions through the API", async () => { expect((await POST(request({ command: "configure", inspectorIds: ["known-user"], legacySupplierIds: ["known-supplier"] }))).status).toBe(400); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); });
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
 it("a known file belonging to a different supplier is rejected before signing", async () => {
  const sign = vi.fn(), filters: Array<[string, unknown]> = [];
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn((key, value) => { filters.push([key, value]); return query; }), in: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ error: null, data: { bucket_id: "integraq-private", object_path: "private-path", original_name: "original.pdf", external_organization_id: "supplier-B" } }) };
  mocks.context.mockResolvedValue({ organizationId: "org-A", admin: { from: vi.fn().mockReturnValue(query), storage: { from: vi.fn().mockReturnValue({ createSignedUrl: sign }) } } });
  mocks.event.mockResolvedValue({ id: "event-A", supplier_id: "supplier-A" });
  const result = await fileGET(new Request("https://integraq.test/file"), { params: Promise.resolve({ eventId: "event-A", fileId: "file-B" }) });
  expect(result.status).toBe(404); expect(sign).not.toHaveBeenCalled(); expect(filters).toContainEqual(["workspace_id", "org-A"]); expect(filters).toContainEqual(["resource_id", "event-A"]);
 });
 it("authorized file download uses a private short-lived URL after individual scope checks", async () => {
  const sign = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example.test/temporary" }, error: null });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ error: null, data: { bucket_id: "integraq-private", object_path: "private-path", original_name: "original.pdf", external_organization_id: "supplier-A" } }) };
  mocks.context.mockResolvedValue({ organizationId: "org-A", admin: { from: vi.fn().mockReturnValue(query), storage: { from: vi.fn().mockReturnValue({ createSignedUrl: sign }) } } }); mocks.event.mockResolvedValue({ id: "event-A", supplier_id: "supplier-A" });
  const result = await fileGET(new Request("https://integraq.test/file?download=true"), { params: Promise.resolve({ eventId: "event-A", fileId: "file-A" }) });
  expect(result.status).toBe(200); expect(sign).toHaveBeenCalledWith("private-path", 60, { download: "original.pdf" }); expect(result.headers.get("Cache-Control")).toBe("private, no-store");
 });
});
