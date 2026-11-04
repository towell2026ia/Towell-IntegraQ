import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "administrator", organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  rows: [] as Array<{ data: unknown; error: unknown }>,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } }) },
  from(table: string) {
    state.calls.push({ table, method: "from", args: [] });
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "insert", "update"]) {
      chain[method] = (...args: unknown[]) => { state.calls.push({ table, method, args }); return chain; };
    }
    chain.maybeSingle = async () => table === "profiles"
      ? { data: { organization_id: state.organizationId, user_type: state.role, status: "active", workspace_mode: "production" }, error: null }
      : state.rows.shift() ?? { data: null, error: null };
    return chain;
  },
}) }));

import { DELETE, GET } from "./route";

const request = (id = "ca-001", reason = "Duplicado") => new Request("https://integraq.test/api/root2cause/demo-retirements", {
  method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reason }),
});
const writes = () => state.calls.filter((call) => call.method === "insert" || call.method === "update");

beforeEach(() => { state.role = "administrator"; state.calls = []; state.rows = []; });

describe("Root2Cause shared sample retirements", () => {
  it("rejects direct deletion attempts by internal, customer and supplier users", async () => {
    for (const role of ["internal", "customer", "supplier"]) {
      state.role = role;
      expect((await DELETE(request())).status).toBe(403);
    }
    expect(writes()).toHaveLength(0);
  });

  it("requires a known sample and reason, with no writes on cancellation", async () => {
    expect((await DELETE(request("ca-999", "Motivo"))).status).toBe(400);
    expect((await DELETE(request("ca-001", " "))).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it("writes an append-only retirement within the actor's organization and reports real persistence", async () => {
    state.rows = [{ data: null, error: null }, { data: { id: "row-id" }, error: null }];
    const response = await DELETE(request());
    expect(response.status).toBe(200);
    expect((await response.json()).retirement).toMatchObject({ id: "ca-001", folio: "AC-2026-014", reason: "Duplicado" });
    expect(writes()).toHaveLength(1);
    expect(writes()[0].args[0]).toMatchObject({ workspace_id: state.organizationId,
      area: "root2causeDemoRetirements", payload: { retirements: [{ id: "ca-001", reason: "Duplicado" }] } });
  });

  it("returns a conflict if another request changed the revision and never claims success", async () => {
    state.rows = [{ data: { id: "row-id", revision: 2, payload: { retirements: [] } }, error: null }, { data: null, error: null }];
    expect((await DELETE(request())).status).toBe(409);
    expect(writes()).toHaveLength(1);
  });

  it("lets internal users read the shared retirements", async () => {
    state.role = "internal";
    state.rows = [{ data: { payload: { retirements: [{ id: "ca-001", deletedAt: "2026-11-02" }] } }, error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).retirements).toHaveLength(1);
    expect(state.calls.filter((call) => call.table === "workspace_data" && call.method === "eq"))
      .toContainEqual({ table: "workspace_data", method: "eq", args: ["workspace_id", state.organizationId] });
  });
});
