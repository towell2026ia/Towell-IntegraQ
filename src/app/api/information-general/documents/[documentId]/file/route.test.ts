import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ actor: { id: "viewer", workspaceId: "workspace-1", administrator: false }, record: { id: "doc", bucket_id: "private", object_path: "original.docx", original_name: "original.docx", preview_path: "converted.pdf", preview_status: "ready", deleted_at: null as string | null }, createAdminClient: vi.fn() }));
vi.mock("@/lib/general-information-server", () => ({
  GeneralInformationApiError: class extends Error { constructor(message: string, readonly status: number) { super(message); } },
  requireGeneralInformationActor: async () => mock.actor,
  generalInformationErrorResponse: (error: Error & { status?: number }) => ({ message: error.message, status: error.status ?? 500 }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mock.createAdminClient }));
import { GET } from "./route";
let sign: ReturnType<typeof vi.fn>, chain: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  mock.actor.administrator = false; mock.record.preview_status = "ready"; mock.record.deleted_at = null;
  sign = vi.fn().mockResolvedValue({ data: { signedUrl: "private-url" } });
  chain = {};
  for (const method of ["select", "eq"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: mock.record }));
  mock.createAdminClient.mockReturnValue({ from: vi.fn(() => chain), storage: { from: vi.fn(() => ({ createSignedUrl: sign })) } });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
async function get(query: string) { return GET(new Request("https://preview.example/api/file?" + query), { params: Promise.resolve({ documentId: "doc" }) }); }
describe("document preview permissions", () => {
  it("serves the converted PDF and retains the workspace/current-document scope", async () => {
    expect((await get("disposition=preview&target=preview")).status).toBe(200);
    expect(sign).toHaveBeenCalledWith("converted.pdf", 120, { download: false });
    expect(chain.eq.mock.calls).toEqual([["id", "doc"], ["workspace_id", "workspace-1"], ["resource_type", "general_information_document"], ["is_current", true]]);
  });
  it("does not let a reader request the protected original instead of an available PDF", async () => {
    expect((await get("disposition=preview&target=original")).status).toBe(403);
    expect(sign).not.toHaveBeenCalled();
  });
  it("retains the existing original preview fallback when no conversion is ready", async () => {
    mock.record.preview_status = "pending";
    expect((await get("disposition=preview&target=original")).status).toBe(200);
    expect(sign).toHaveBeenCalledWith("original.docx", 120, { download: false });
  });
  it("keeps original downloads restricted to the administrator", async () => {
    expect((await get("disposition=download")).status).toBe(403);
    expect(sign).not.toHaveBeenCalled();
  });
  it("does not sign a logically deleted document", async () => {
    mock.record.deleted_at = "2026-10-27";
    expect((await get("disposition=preview")).status).toBe(404);
    expect(sign).not.toHaveBeenCalled();
  });
});
