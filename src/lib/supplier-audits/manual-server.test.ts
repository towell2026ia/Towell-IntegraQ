import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ context: vi.fn(), event: vi.fn(), rpc: vi.fn(), session: vi.fn(), createClient: vi.fn(), admin: vi.fn(), sign: vi.fn(), from: vi.fn(), filters: [] as unknown[][], rows: [] as unknown[], assessment: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("./server", async () => ({ ...await vi.importActual<typeof import("./server")>("./server"), auditContext: m.context, auditEvent: m.event }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: m.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
import { readManual, saveManual, readSupplierAuditPortal, supplierAuditPortalFile } from "./manual-server";
import { emptyManualRecord } from "./manual";
import { SupplierAuditError } from "./server";
import { GET, POST } from "@/app/api/suppliers/audits/[eventId]/manual/route";
const id = "11111111-1111-4111-8111-111111111111", supplier = "22222222-2222-4222-8222-222222222222", org = "33333333-3333-4333-8333-333333333333", file = "44444444-4444-4444-8444-444444444444";
const event = () => ({ id, supplier_id: supplier, organization_id: org, revision: 7, withdrawn_at: null, state: "performed", source_sha256: null, actual_date: null });
const snapshot = () => ({ version: 1, eventId: id, supplierId: supplier, revision: 7, record: emptyManualRecord(), history: [] });
const command = () => ({ revision: 7, requestId: file, record: emptyManualRecord(), reason: "Captura manual de prueba", confirmed: true });
const fileRow = () => ({ id: file, resource_id: id, resource_type: "supplier_audit_report", original_name: "original.pdf", is_current: false, version: 1, created_at: "2026-11-10T00:00:00Z", size_bytes: 100 });
beforeEach(() => {
 vi.clearAllMocks(); m.filters = []; m.rows = [fileRow()]; m.assessment = null;
 m.from.mockImplementation((table: string) => { const q = { select: vi.fn().mockReturnThis(), eq: vi.fn((...args: unknown[]) => { m.filters.push(args); return q; }), in: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ error: null, data: m.assessment })), then: (resolve: (x: unknown) => unknown) => resolve({ error: null, data: table === "file_objects" ? m.rows : null }) }; return q; });
 m.context.mockResolvedValue({ organizationId: org, canManage: true, supabase: { rpc: m.rpc }, admin: { from: m.from } }); m.event.mockResolvedValue(event());
 m.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "iq_supplier_audit_manual_read" ? snapshot() : { eventId: id, revision: 8, requestId: file } }));
 m.session.mockResolvedValue({ authUserId: id, userType: "Proveedor", workspaceMode: "production", externalParty: { kind: "supplier", companyId: supplier } });
 m.createClient.mockResolvedValue({ rpc: m.rpc, from: m.from }); m.sign.mockResolvedValue({ error: null, data: { signedUrl: "https://private.example.test/signed" } }); m.admin.mockReturnValue({ storage: { from: vi.fn().mockReturnValue({ createSignedUrl: m.sign }) } });
});
describe("manual audit server and HTTP", () => {
 it("reads using internal scoped context and never modifies a record", async () => { expect((await readManual(id)).revision).toBe(7); expect(m.context).toHaveBeenCalledWith("view"); expect(m.rpc).toHaveBeenCalledExactlyOnceWith("iq_supplier_audit_manual_read", { p_event: id }); });
 it("fails closed if the contract is not activated", async () => { m.rpc.mockResolvedValue({ error: { code: "PGRST202" }, data: null }); await expect(saveManual(id, command())).rejects.toMatchObject({ status: 503 }); expect(m.rpc).not.toHaveBeenCalledWith("iq_supplier_audit_manual_save", expect.anything()); expect(m.from).not.toHaveBeenCalled(); });
 it("sends exact version, identity, reason and record to the transactional user-scoped RPC", async () => { expect(await saveManual(id, command())).toEqual({ saved: true, eventId: id, revision: 8 }); expect(m.rpc).toHaveBeenLastCalledWith("iq_supplier_audit_manual_save", { p_event: id, p_expected_revision: 7, p_request_id: file, p_record: emptyManualRecord(), p_reason: "Captura manual de prueba" }); expect(m.filters).toContainEqual(["workspace_id", org]); expect(m.filters).toContainEqual(["resource_id", id]); });
 it.each([401, 403])("rejects session/permissions %s before mutation", async status => { m.context.mockRejectedValue(new SupplierAuditError("Denied", status)); await expect(saveManual(id, command())).rejects.toMatchObject({ status }); expect(m.rpc).not.toHaveBeenCalled(); });
 it("rejects a different internal organization before any manual query", async () => { m.event.mockRejectedValue(new SupplierAuditError("Unavailable", 404)); await expect(readManual(id)).rejects.toMatchObject({ status: 404 }); expect(m.rpc).not.toHaveBeenCalled(); });
 it.each([{ withdrawn_at: "2026-11-10" }, { state: "cancelled" }])("preserves withdrawal/cancellation locks %j", async patch => { m.event.mockResolvedValue({ ...event(), ...patch }); await expect(saveManual(id, command())).rejects.toMatchObject({ status: 409 }); expect(m.rpc).not.toHaveBeenCalled(); });
 it("rejects stale revisions and does not reapply old requests", async () => { await expect(saveManual(id, { ...command(), revision: 6 })).rejects.toMatchObject({ status: 409 }); expect(m.rpc).not.toHaveBeenCalled(); });
 it("cannot publish an unlinked event", async () => { m.event.mockResolvedValue({ ...event(), supplier_id: null }); await expect(saveManual(id, { ...command(), record: { ...emptyManualRecord(), classification: "service", portalVisible: true } })).rejects.toMatchObject({ status: 409 }); expect(m.rpc).not.toHaveBeenCalled(); });
 it("allows incomplete internal data for an unlinked event", async () => { m.event.mockResolvedValue({ ...event(), supplier_id: null }); expect((await saveManual(id, command())).saved).toBe(true); });
 it("rejects an altered historical audit date", async () => { m.event.mockResolvedValue({ ...event(), source_sha256: "original-hash", actual_date: "2025-11-19" }); await expect(saveManual(id, command())).rejects.toMatchObject({ status: 409 }); expect(m.rpc).not.toHaveBeenCalled(); });
 it("retains existing assessment and refuses a competing manual grade", async () => { m.assessment = { id: supplier }; await expect(saveManual(id, { ...command(), record: { ...emptyManualRecord(), methodology: "V1", score: { value: 99.1667, sourceFileId: file, reference: "Página 1", verified: true } } })).rejects.toMatchObject({ status: 409 }); expect(m.rpc).toHaveBeenCalledTimes(1); });
 it("does not drop stored actions", async () => { m.rpc.mockResolvedValue({ error: null, data: { ...snapshot(), record: { ...emptyManualRecord(), actions: [{ id: file, description: "Action", responsibleName: "QA", commitmentDate: "2026-12-03", status: "pending", completedDate: null, evidenceFileIds: [] }] } } }); await expect(saveManual(id, command())).rejects.toMatchObject({ status: 409 }); expect(m.rpc).toHaveBeenCalledTimes(1); });
 it("does not overwrite a verified historical manual score or methodology", async () => { m.rpc.mockResolvedValue({ error: null, data: { ...snapshot(), record: { ...emptyManualRecord(), methodology: "V1", score: { value: 99.1667, sourceFileId: file, reference: "Portada", verified: true } } } }); await expect(saveManual(id, command())).rejects.toMatchObject({ status: 409 }); });
 it("rejects a foreign document even if its ID is known", async () => { await expect(saveManual(id, { ...command(), record: { ...emptyManualRecord(), approvedFileIds: [supplier] } })).rejects.toMatchObject({ status: 400 }); expect(m.rpc).toHaveBeenCalledTimes(1); });
 it("reports a lost or malformed confirmation and never retries automatically", async () => { m.rpc.mockResolvedValueOnce({ error: null, data: snapshot() }).mockResolvedValueOnce({ error: null, data: { eventId: id, revision: 8, requestId: "wrong" } }); await expect(saveManual(id, command())).rejects.toMatchObject({ status: 503 }); expect(m.rpc).toHaveBeenCalledTimes(2); });
 it("maps a concurrent database conflict without claiming success", async () => { m.rpc.mockResolvedValueOnce({ error: null, data: snapshot() }).mockResolvedValueOnce({ error: { code: "P0001", message: "MANUAL_CONFLICT" } }); await expect(saveManual(id, command())).rejects.toMatchObject({ status: 409 }); });
 it("HTTP GET is private/no-store and POST validates malformed JSON", async () => { const params = { params: Promise.resolve({ eventId: id }) }; const response = await GET(new Request("https://local.test"), params); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect((await POST(new Request("https://local.test", { method: "POST", body: "{" }), params)).status).toBe(400); });
});
describe("supplier-specific portal and private file signing", () => {
 const portal = () => ({ version: 1, audits: [{ eventId: id, supplierId: supplier, auditDate: "2025-11-19", classification: "manufacturer", methodology: "V1", score: 99.1667, actions: [], files: [fileRow()], source_payload: { secretInternalNote: "must not leak" } }] });
 const authorizedFile = () => ({ eventId: id, id: file, supplierId: supplier, organizationId: org, bucket: "integraq-private", path: `${org}/supplier-audits/${id}/${file}/original.pdf`, authorized: true, name: "original.pdf" });
 it("uses the session supplier and excludes all internal metadata", async () => { m.rpc.mockResolvedValue({ data: portal(), error: null }); const data = await readSupplierAuditPortal(); expect(data.audits[0].score).toBe(99.1667); expect(data.scheduleAvailable).toBe(false); expect(m.filters).toContainEqual(["supplier_id", supplier]); expect(m.admin).not.toHaveBeenCalled(); expect(JSON.stringify(data)).not.toContain("secretInternalNote"); expect(m.rpc).toHaveBeenCalledExactlyOnceWith("iq_supplier_audit_portal_list"); });
 it("loads the schedule only for already published events with the supplier session", async () => {
   m.rpc.mockResolvedValue({ data: portal(), error: null });
   const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), is: vi.fn().mockResolvedValue({ data: [{ id, planned_date: "2026-12-03", state: "scheduled" }] }) };
   m.from.mockReturnValueOnce(query);
   const data = await readSupplierAuditPortal();
   expect(query.in).toHaveBeenCalledWith("id", [id]);
   expect(query.eq).toHaveBeenCalledWith("supplier_id", supplier);
   expect(query.is).toHaveBeenCalledWith("withdrawn_at", null);
   expect(data.scheduleAvailable).toBe(true);
   expect(data.audits[0].plannedDate).toBe("2026-12-03");
   expect(m.admin).not.toHaveBeenCalled();
 });
 it.each(["Cliente", "Usuario interno", "Administrador"])("does not grant supplier scope to %s", async userType => { m.session.mockResolvedValue({ authUserId: id, userType, externalParty: { kind: "supplier", companyId: supplier } }); await expect(readSupplierAuditPortal()).rejects.toMatchObject({ status: 403 }); expect(m.rpc).not.toHaveBeenCalled(); });
 it("rejects unauthenticated readers", async () => { m.session.mockResolvedValue(null); await expect(readSupplierAuditPortal()).rejects.toMatchObject({ status: 401 }); });
 it("rejects cross-supplier data before exposing any part of the response", async () => { const data = portal(); data.audits[0].supplierId = org; m.rpc.mockResolvedValue({ data, error: null }); await expect(readSupplierAuditPortal()).rejects.toMatchObject({ status: 403 }); });
 it("rejects documents from another event", async () => { const data = portal(); data.audits[0].files[0].resource_id = org; m.rpc.mockResolvedValue({ data, error: null }); await expect(readSupplierAuditPortal()).rejects.toMatchObject({ status: 403 }); });
 it.each([{ supplierId: org }, { eventId: org }, { authorized: false }, { bucket: "public" }, { path: "another-event/original.pdf" }])("refuses file signing for manipulated authorization %j", async patch => { m.rpc.mockResolvedValue({ data: { ...authorizedFile(), ...patch }, error: null }); await expect(supplierAuditPortalFile(id, file, true)).rejects.toMatchObject({ status: 404 }); expect(m.sign).not.toHaveBeenCalled(); });
 it("signs only after the supplier-scoped RPC authorizes the exact file", async () => { m.rpc.mockResolvedValue({ data: authorizedFile(), error: null }); expect((await supplierAuditPortalFile(id, file, true)).expiresIn).toBe(60); expect(m.rpc).toHaveBeenCalledWith("iq_supplier_audit_portal_file", { p_event: id, p_file: file }); expect(m.sign).toHaveBeenCalledWith(authorizedFile().path, 60, { download: "original.pdf" }); });
 it("retired, unpublished or unlinked files returned as unavailable are never signed", async () => { m.rpc.mockResolvedValue({ data: null, error: null }); await expect(supplierAuditPortalFile(id, file, false)).rejects.toMatchObject({ status: 404 }); expect(m.admin).not.toHaveBeenCalled(); });
});


describe("transaction contract and historical protection regressions (mocked RPC)", () => {
 it("refuses future actual dates before any write RPC", async () => {
   await expect(saveManual(id, { ...command(), record: { ...emptyManualRecord(), auditDate: "2200-01-01" } })).rejects.toMatchObject({ status: 400 });
   expect(m.rpc).not.toHaveBeenCalled();
 });
 it("does not infer completion from a future commitment", async () => {
   const record = { ...emptyManualRecord(), actions: [{ id: file, description: "Revisar", responsibleName: "Calidad", commitmentDate: "2200-01-01", status: "pending", completedDate: null, evidenceFileIds: [] }] };
   await saveManual(id, { ...command(), record });
   expect(m.rpc).toHaveBeenLastCalledWith("iq_supplier_audit_manual_save", expect.objectContaining({ p_record: record }));
 });
 it("rejects a future conclusion even with explicit closed status", async () => {
   const record = { ...emptyManualRecord(), actions: [{ id: file, description: "Revisar", responsibleName: "Calidad", commitmentDate: "2025-01-01", status: "closed", completedDate: "2200-01-01", evidenceFileIds: [] }] };
   await expect(saveManual(id, { ...command(), record })).rejects.toMatchObject({ status: 400 }); expect(m.rpc).not.toHaveBeenCalled();
 });
 it("preserves a structured historical assessment date without requiring source_sha256", async () => {
   m.assessment = { id: supplier }; m.event.mockResolvedValue({ ...event(), actual_date: "2025-11-19" });
   await expect(saveManual(id, command())).rejects.toMatchObject({ status: 409 }); expect(m.rpc).toHaveBeenCalledTimes(1);
 });
 it("preserves the previously recorded historical methodology", async () => {
   m.assessment = { id: supplier };
   m.rpc.mockResolvedValue({ data: { ...snapshot(), record: { ...emptyManualRecord(), methodology: "V1" } }, error: null });
   await expect(saveManual(id, { ...command(), record: { ...emptyManualRecord(), methodology: "V2" } })).rejects.toMatchObject({ status: 409 }); expect(m.rpc).toHaveBeenCalledTimes(1);
 });
 it("halts if another writer changes revision between event read and capability read", async () => {
   m.rpc.mockResolvedValue({ data: { ...snapshot(), revision: 8 }, error: null });
   await expect(saveManual(id, command())).rejects.toMatchObject({ status: 503 }); expect(m.rpc).toHaveBeenCalledTimes(1);
 });
 it.each(["MANUAL_REPLAY_STALE", "MANUAL_REQUEST_REUSED", "MANUAL_HISTORICAL_DATE", "MANUAL_HISTORICAL_SCORE", "MANUAL_HISTORICAL_METHOD", "MANUAL_ACTION_PRESERVATION", "MANUAL_EXISTING_ASSESSMENT"])("handles SQL conflict %s without retrying or reporting success", async message => {
   m.rpc.mockResolvedValueOnce({ data: snapshot(), error: null }).mockResolvedValueOnce({ error: { code: "P0001", message }, data: null });
   await expect(saveManual(id, command())).rejects.toMatchObject({ status: 409 }); expect(m.rpc).toHaveBeenCalledTimes(2);
 });
 it("requires re-reading after a lost response and does not reapply the old payload", async () => {
   m.rpc.mockResolvedValueOnce({ data: snapshot(), error: null }).mockRejectedValueOnce(new Error("network response lost"));
   await expect(saveManual(id, command())).rejects.toThrow("network response lost");
   m.event.mockResolvedValue({ ...event(), revision: 8 });
   await expect(saveManual(id, command())).rejects.toMatchObject({ status: 409 });
   expect(m.rpc.mock.calls.filter(([name]) => name === "iq_supplier_audit_manual_save")).toHaveLength(1);
 });
 it("does not fall back to an older PDF when Storage signing fails", async () => {
   m.rpc.mockResolvedValue({ data: { eventId: id, id: file, supplierId: supplier, organizationId: org, bucket: "integraq-private", path: `${org}/supplier-audits/${id}/${file}/original.pdf`, authorized: true, name: "original.pdf" }, error: null });
   m.sign.mockResolvedValue({ data: null, error: { message: "Object unavailable" } });
   await expect(supplierAuditPortalFile(id, file, true)).rejects.toMatchObject({ status: 503 }); expect(m.sign).toHaveBeenCalledTimes(1);
 });
 it.each(["MANUAL_PORTAL_ACCESS_DENIED", "MANUAL_PORTAL_DOCUMENT_DENIED"])("does not sign a URL after database denial %s", async message => {
   m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message } });
   await expect(supplierAuditPortalFile(id, file, false)).rejects.toMatchObject({ status: 403 }); expect(m.admin).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
 });
});
