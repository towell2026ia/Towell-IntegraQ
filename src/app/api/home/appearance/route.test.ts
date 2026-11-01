import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";
const state = vi.hoisted(() => ({ session: null as ActiveSession | null, responses: [] as Array<{ data: unknown; error: unknown }>, calls: [] as Array<{ method: string; args: unknown[] }> }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  state.calls.push({ method: "from", args: [table] });
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "update", "insert"]) chain[method] = (...args: unknown[]) => { state.calls.push({ method, args }); return chain; };
  chain.maybeSingle = async () => state.responses.shift() ?? { data: null, error: null };
  return chain;
} }) }));
import { GET, PATCH } from "./route";
const profile = { organization_id: "authorized-org", workspace_mode: "production", status: "active", user_type: "administrator" };
const request = (body: unknown) => new Request("https://integraq.test/api/home/appearance", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
beforeEach(() => { state.session = { ...activeSession, authUserId: "real-user" }; state.responses = [{ data: profile, error: null }]; state.calls = []; });
describe("Home appearance authorization and persistence", () => {
  it("requires a real session", async () => { state.session = null; expect((await GET()).status).toBe(401); expect(state.calls).toEqual([]); });
  it("blocks external accounts even with stale internal assignments", async () => { state.session!.userType = "Cliente"; expect((await GET()).status).toBe(403); expect(state.calls).toEqual([]); });
  it("loads defaults only when no persisted configuration exists", async () => {
    expect(await (await GET()).json()).toEqual({ textSize: 100, revision: 0 });
    expect(state.calls).toContainEqual({ method: "eq", args: ["workspace_id", "authorized-org"] });
    expect(state.calls).toContainEqual({ method: "eq", args: ["workspace_mode", "production"] });
  });
  it("loads the persisted scale on a new request", async () => {
    state.responses.push({ data: { payload: { textSize: 130 }, revision: 4 }, error: null });
    expect(await (await GET()).json()).toEqual({ textSize: 130, revision: 4 });
  });
  it("reports database failures instead of pretending settings were loaded", async () => {
    state.responses.push({ data: null, error: { message: "unavailable" } }); expect((await GET()).status).toBe(500);
  });
  it("requires both the session and persisted administrator role", async () => {
    state.responses[0] = { data: { ...profile, user_type: "internal" }, error: null };
    expect((await PATCH(request({ textSize: 130, revision: 0 }))).status).toBe(403);
    expect(state.calls.some(call => call.method === "insert" || call.method === "update")).toBe(false);
  });
  it.each([0, 99, 101, 140, "110", null])("rejects unsupported scale %s", async textSize => { expect((await PATCH(request({ textSize, revision: 0 }))).status).toBe(400); });
  it("rejects a stale edit before writing", async () => {
    state.responses.push({ data: { id: "row", payload: { textSize: 120 }, revision: 3 }, error: null });
    expect((await PATCH(request({ textSize: 110, revision: 2 }))).status).toBe(409);
    expect(state.calls.some(call => call.method === "update")).toBe(false);
  });
  it("preserves other payload fields and scopes compare-and-swap to the authenticated workspace", async () => {
    state.responses.push({ data: { id: "row", payload: { textSize: 100, retained: "history" }, revision: 2 }, error: null }, { data: { payload: { textSize: 120 }, revision: 3 }, error: null });
    expect(await (await PATCH(request({ textSize: 120, revision: 2, workspace_id: "other-org" }))).json()).toEqual({ textSize: 120, revision: 3 });
    expect(state.calls).toContainEqual({ method: "update", args: [{ payload: { textSize: 120, retained: "history" }, updated_by: "real-user" }] });
    expect(state.calls).toContainEqual({ method: "eq", args: ["revision", 2] });
    expect(state.calls).not.toContainEqual({ method: "eq", args: ["workspace_id", "other-org"] });
  });
  it("does not overwrite a concurrent update", async () => {
    state.responses.push({ data: { id: "row", payload: { textSize: 100 }, revision: 2 }, error: null }, { data: null, error: null });
    expect((await PATCH(request({ textSize: 130, revision: 2 }))).status).toBe(409);
  });
  it("keeps DEMO writes in the persisted demo workspace", async () => {
    state.responses[0] = { data: { ...profile, workspace_mode: "demo" }, error: null };
    state.responses.push({ data: null, error: null }, { data: { payload: { textSize: 110 }, revision: 1 }, error: null });
    expect((await PATCH(request({ textSize: 110, revision: 0 }))).status).toBe(200);
    expect(state.calls.find(call => call.method === "insert")?.args[0]).toMatchObject({ workspace_id: "authorized-org", workspace_mode: "demo", area: "homeAppearance" });
  });
});