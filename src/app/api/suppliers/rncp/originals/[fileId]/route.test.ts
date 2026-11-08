import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ context: vi.fn(), reports: vi.fn(), sign: vi.fn(), file: null as Record<string, unknown> | null }));
vi.mock("@/lib/rncp/server", () => ({ rncpContext: state.context, loadMatrixReports: state.reports, RncpError: class extends Error { constructor(message: string, public status = 400) { super(message); } } }));
import { GET } from "./route";
const org = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const fileId = "00000000-0000-4000-8000-000000000003";
function call(query = "") { return GET(new Request("https://integraq.test/api/suppliers/rncp/originals/" + fileId + query), { params: Promise.resolve({ fileId }) }); }
beforeEach(() => {
  vi.resetAllMocks();
  state.file = { id: fileId, workspace_id: org, resource_id: "report", resource_type: "supplier_rncp_original", bucket_id: "integraq-private", object_path: `rncp-originals/${org}/original.pdf`, original_name: "original.pdf", deleted_at: null };
  const query = { select: () => query, eq: () => query, in: () => query, maybeSingle: async () => ({ data: state.file, error: null }) };
  state.context.mockResolvedValue({ organizationId: org, profile: { user_type: "internal" }, admin: { from: () => query, storage: { from: () => ({ createSignedUrl: state.sign }) } } });
  state.reports.mockResolvedValue([{ organizationId: org }]);
  state.sign.mockResolvedValue({ data: { signedUrl: "https://private.test/temporary" }, error: null });
});
describe("private RNCP original access before inline rendering", () => {
  it("does not sign when the live session is unauthorized", async () => { state.context.mockRejectedValue(new Error("Session denied")); await call(); expect(state.sign).not.toHaveBeenCalled(); });
  it("denies a report outside authorized RLS scope before signing", async () => { const { RncpError } = await import("@/lib/rncp/server"); state.reports.mockRejectedValue(new RncpError("Denied", 403)); expect((await call()).status).toBe(403); expect(state.sign).not.toHaveBeenCalled(); });
  it("denies another organization even when the requested file exists", async () => { state.file!.workspace_id = other; expect((await call()).status).toBe(403); expect(state.sign).not.toHaveBeenCalled(); });
  it.each(["deleted", "wrong bucket", "wrong path", "pending without administrator"])("does not sign %s files", async kind => {
    if (kind === "deleted") state.file!.deleted_at = "2026-01-01";
    if (kind === "wrong bucket") state.file!.bucket_id = "public";
    if (kind === "wrong path") state.file!.object_path = `rncp-originals/${other}/original.pdf`;
    if (kind === "pending without administrator") state.file!.resource_type = "supplier_rncp_import_pending";
    expect((await call()).status).toBe(403); expect(state.sign).not.toHaveBeenCalled();
  });
  it("signs an authorized original for 60 seconds with private no-store caching", async () => { const response = await call(); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(state.sign).toHaveBeenCalledWith(`rncp-originals/${org}/original.pdf`, 60, undefined); expect((await response.json()).expiresIn).toBe(60); });
  it("uses the same authorized file for an attachment download", async () => { expect((await call("?download=1")).status).toBe(200); expect(state.sign).toHaveBeenCalledWith(`rncp-originals/${org}/original.pdf`, 60, { download: "original.pdf" }); });
});