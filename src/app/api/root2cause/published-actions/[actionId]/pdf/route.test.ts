import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as unknown, admin: vi.fn() }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => mocks.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: vi.fn() }) }));

import { GET, POST } from "./route";

describe("Root2Cause official PDF API guard", () => {
  beforeEach(() => { mocks.session = null; mocks.admin.mockReset(); });

  it("rejects an invalid action ID before database access", async () => {
    const response = await GET(new Request("https://integraq.test"), { params: Promise.resolve({ actionId: "invalid" }) });
    expect(response.status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("requires an authenticated internal actor for reading or generating a PDF", async () => {
    const context = { params: Promise.resolve({ actionId: "c9d62a40-bbc9-48dc-9415-6020721261df" }) };
    expect((await GET(new Request("https://integraq.test"), context)).status).toBe(403);
    expect((await POST(new Request("https://integraq.test", { method: "POST" }), context)).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
