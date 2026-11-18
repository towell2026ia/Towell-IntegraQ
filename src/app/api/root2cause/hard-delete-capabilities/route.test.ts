import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

import { GET } from "./route";

const admin = { authUserId: "actor", userType: "Administrador", moduleActionPermissions: [{ moduleId: "corrective-actions", action: "manage", source: "direct" }] };

describe("Root2Cause hard-delete capability gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue(admin);
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("is disabled unless the server-side release flag is explicitly true", async () => {
    vi.stubEnv("ROOT2CAUSE_HARD_DELETE_ENABLED", "false");
    const response = await GET();
    expect(await response.json()).toEqual({ enabled: false });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires the explicit server flag, the authorized session, and the installed database contract", async () => {
    vi.stubEnv("ROOT2CAUSE_HARD_DELETE_ENABLED", "true");
    const response = await GET();
    expect(await response.json()).toEqual({ enabled: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("iq_root2cause_hard_delete_contract");
  });
});
