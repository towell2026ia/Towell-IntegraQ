import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), createClient: vi.fn(), permitted: vi.fn() }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: m.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.createClient }));
vi.mock("@/lib/module-permissions", () => ({ canPerformModuleAction: m.permitted }));
import { PUT } from "./route";
import { QUALITY_OBJECTIVES } from "@/lib/indicators/quality-objectives";
const request = (objective: unknown, expectedUpdatedAt = "2026-11-17T00:00:00Z") => new Request("https://integraq.test/api/indicators/objective", { method: "PUT", body: JSON.stringify({ indicatorId: "IND-013", objective, expectedUpdatedAt }) });
describe("indicator quality objective editing", () => {
  beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue({ authUserId: "actor", userType: "Usuario interno" }); m.permitted.mockReturnValue(true); m.createClient.mockResolvedValue({ rpc: m.rpc }); m.rpc.mockResolvedValue({ data: "2026-11-17T01:00:00Z", error: null }); });
  it("uses only the scoped RPC and accepts one of five controlled objectives", async () => {
    expect(QUALITY_OBJECTIVES).toHaveLength(5);
    expect((await PUT(request(QUALITY_OBJECTIVES[1]))).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("iq_indicator_set_quality_objective", { p_code: "IND-013", p_expected_updated_at: "2026-11-17T00:00:00Z", p_objective: QUALITY_OBJECTIVES[1] });
  });
  it("allows removal without updating other indicator fields", async () => { expect((await PUT(request(""))).status).toBe(200); expect(m.rpc.mock.calls[0][1].p_objective).toBe(""); });
  it("rejects an arbitrary objective and missing version before a database call", async () => { expect((await PUT(request("Inventado"))).status).toBe(400); expect((await PUT(request(QUALITY_OBJECTIVES[0], ""))).status).toBe(400); expect(m.rpc).not.toHaveBeenCalled(); });
  it("denies a reader and keeps the indicator untouched", async () => { m.permitted.mockReturnValue(false); expect((await PUT(request(QUALITY_OBJECTIVES[0]))).status).toBe(403); expect(m.rpc).not.toHaveBeenCalled(); });
  it("surfaces a concurrent change as a conflict", async () => { m.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "INDICATOR_OBJECTIVE_CONFLICT" } }); expect((await PUT(request(QUALITY_OBJECTIVES[0]))).status).toBe(409); });
  it("fails closed before the approved SQL is installed", async () => { m.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } }); expect((await PUT(request(QUALITY_OBJECTIVES[0]))).status).toBe(503); });
});
