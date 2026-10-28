import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  claims: vi.fn(), profile: vi.fn(), before: vi.fn(), rpc: vi.fn(), upload: vi.fn(),
  admin: vi.fn(), server: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { POST } from "./route";

function request(revision = "0", origin = "https://preview.test") {
  const body = new FormData();
  body.set("slot", "quality"); body.set("expectedRevision", revision);
  body.set("reason", "Actualizar política"); body.set("confirmed", "true");
  body.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "fixture.png", { type: "image/png" }));
  return new Request("https://preview.test/api/home/images", { method: "POST", headers: { origin }, body });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "admin" } }, error: null });
  mocks.profile.mockResolvedValue({ data: { id: "admin", user_type: "administrator", status: "active", organization_id: "org", workspace_mode: "demo" }, error: null });
  mocks.before.mockResolvedValue({ data: null, error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ data: { id: "new", revision: 1, slot: "quality" }, error: null });
  const profile = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: mocks.profile };
  const history = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: mocks.before };
  mocks.server.mockResolvedValue({ auth: { getClaims: mocks.claims }, from: (table: string) => table === "profiles" ? profile : history, rpc: mocks.rpc });
  mocks.admin.mockReturnValue({ storage: { from: () => ({ upload: mocks.upload }) } });
});
describe("home image publication boundary", () => {
  it("rejects another origin before authentication or storage access", async () => {
    expect((await POST(request("0", "https://other.test"))).status).toBe(403);
    expect(mocks.server).not.toHaveBeenCalled();
  });
  it("requires a real active administrator profile", async () => {
    mocks.profile.mockResolvedValue({ data: { id: "internal", user_type: "internal", status: "active", organization_id: "org" }, error: null });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a stale draft before uploading any object", async () => {
    mocks.before.mockResolvedValue({ data: { id: "other", revision: 2 }, error: null });
    expect((await POST(request("1"))).status).toBe(409);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not upload when the current revision cannot be read", async () => {
    mocks.before.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("still relies on the transaction to reject races after upload", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledWith("publish_home_image", expect.objectContaining({ expected_revision: 0, confirmed: true }));
  });
  it("publishes a confirmed attachment in the profile workspace", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.upload.mock.calls[0][0]).toMatch(/^org\/demo\/admin\//);
    expect(mocks.upload.mock.calls[0][2]).toMatchObject({ upsert: false });
    expect(await response.json()).toEqual({ version: { id: "new", revision: 1, slot: "quality" } });
  });
});

describe("retained image restoration", () => {
  it("recovers a previous version by publishing a new revision without uploading or replacing its object", async () => {
    mocks.before.mockResolvedValue({ data: { id: "current", revision: 2 }, error: null });
    mocks.rpc.mockResolvedValue({ data: { id: "restored-copy", revision: 3, slot: "quality" }, error: null });
    const body = new FormData();
    body.set("slot", "quality"); body.set("expectedRevision", "2"); body.set("reason", "Recuperar imagen anterior");
    body.set("confirmed", "true"); body.set("restoreVersion", "11111111-1111-4111-8111-111111111111");
    const response = await POST(new Request("https://preview.test/api/home/images", { method: "POST", headers: { origin: "https://preview.test" }, body }));
    expect(response.status).toBe(200);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("publish_home_image", expect.objectContaining({
      expected_revision: 2, restore_version: "11111111-1111-4111-8111-111111111111", new_object_path: null, new_file_name: null,
    }));
    expect((await response.json()).version.revision).toBe(3);
  });
});
