import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ server: vi.fn(), admin: vi.fn(), claims: vi.fn(), profile: vi.fn(), read: vi.fn(), sign: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { GET } from "./route";
const oldId = "11111111-1111-4111-8111-111111111111";
const rows = [
  { id: "current", slot: "quality", revision: 2, object_path: "org/demo/current.png", file_name: "current.png", reason: "Second image", created_at: "2026-10-27" },
  { id: oldId, slot: "quality", revision: 1, object_path: "org/demo/original.png", file_name: "original.png", reason: "First image", created_at: "2026-10-26" },
];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "admin" } }, error: null });
  mocks.profile.mockResolvedValue({ data: { id: "admin", user_type: "administrator", status: "active", organization_id: "org", workspace_mode: "demo" }, error: null });
  mocks.read.mockResolvedValue({ data: rows, error: null });
  mocks.sign.mockImplementation(async (path: string) => ({ data: { signedUrl: "https://preview.test/signed/" + path }, error: null }));
  const profile = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: mocks.profile };
  const history = { select: vi.fn().mockReturnThis(), eq: mocks.eq, order: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => mocks.read().then(resolve, reject) };
  mocks.eq.mockReturnValue(history);
  mocks.server.mockResolvedValue({ auth: { getClaims: mocks.claims }, from: (table: string) => table === "profiles" ? profile : history });
  mocks.admin.mockReturnValue({ storage: { from: () => ({ createSignedUrl: mocks.sign }) } });
});
describe("Home current and historical image reads", () => {
  it("lets an administrator inspect a retained version through a fresh private URL", async () => {
    mocks.read.mockResolvedValue({ data: [rows[1]], error: null });
    const response = await GET(new Request("https://preview.test/api/home/images?version=" + oldId));
    expect(response.status).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(mocks.eq).toHaveBeenCalledWith("workspace_mode", "demo");
    expect(mocks.eq).toHaveBeenCalledWith("id", oldId);
    expect(mocks.sign).toHaveBeenCalledWith("org/demo/original.png", 600);
    expect((await response.json()).versions[0].url).toContain("original.png");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("shows authorized internal users only the current image outside edit mode", async () => {
    mocks.profile.mockResolvedValue({ data: { id: "reader", user_type: "internal", status: "active", organization_id: "org", workspace_mode: "demo" }, error: null });
    const response = await GET(new Request("https://preview.test/api/home/images"));
    const payload = await response.json();
    expect(payload.versions).toHaveLength(1);
    expect(payload.versions[0].id).toBe("current");
    expect(payload.versions[0].url).toContain("current.png");
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
  it("rejects historical reads by a non-administrator before signing any URL", async () => {
    mocks.profile.mockResolvedValue({ data: { id: "reader", user_type: "internal", status: "active", organization_id: "org", workspace_mode: "demo" }, error: null });
    expect((await GET(new Request("https://preview.test/api/home/images?version=" + oldId))).status).toBe(403);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("does not sign a version outside the authorized scope", async () => {
    mocks.read.mockResolvedValue({ data: [], error: null });
    expect((await GET(new Request("https://preview.test/api/home/images?version=" + oldId))).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("refuses unauthenticated reads and invalid version identifiers", async () => {
    expect((await GET(new Request("https://preview.test/api/home/images?version=invalid"))).status).toBe(400);
    mocks.claims.mockResolvedValue({ data: null, error: new Error("expired") });
    expect((await GET(new Request("https://preview.test/api/home/images"))).status).toBe(401);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
