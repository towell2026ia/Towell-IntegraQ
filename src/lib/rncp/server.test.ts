import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const state = vi.hoisted(() => ({ session: null as ActiveSession | null,
  profile: { id: "actor", organization_id: "org-a", external_party_id: null as string | null, user_type: "internal", status: "active", workspace_mode: "production" },
  owner: { kind: "internal", active: true }, permitted: true, scope: "org-a", scopeError: null as { code: string } | null,
  privilegedTables: [] as string[], rpc: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
vi.mock("@/lib/module-permissions", () => ({ canPerformModuleAction: () => state.permitted }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: state.profile, error: null }) }; return query;
}, rpc: async (name: string) => { state.rpc.push(name); return { data: state.scope, error: state.scopeError }; } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  state.privilegedTables.push(table); const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: state.owner, error: null }) }; return query;
} }) }));

import { paginatedRows, rncpContext } from "./server";
import { POST as importMatrix } from "@/app/api/suppliers/rncp/import/route";
import { POST as uploadPdf } from "@/app/api/suppliers/rncp/originals/route";
import { POST as followup } from "@/app/api/suppliers/rncp/follow-up/route";

beforeEach(() => {
  state.session = { ...activeSession, authUserId: "actor", userType: "Usuario interno", workspaceMode: "production" };
  state.profile = { id: "actor", organization_id: "org-a", external_party_id: null, user_type: "internal", status: "active", workspace_mode: "production" };
  state.owner = { kind: "internal", active: true }; state.scope = "org-a"; state.scopeError = null; state.permitted = true; state.privilegedTables = []; state.rpc = [];
});

describe("live RNCP authorization before privileged queries", () => {
  it("requires a valid authenticated session", async () => { state.session = null; await expect(rncpContext()).rejects.toMatchObject({ status: 401 }); expect(state.privilegedTables).toEqual([]); });
  it.each(["customer", "supplier"])("denies %s access to internal matrix, imports and uploads", async role => { state.profile.user_type = role;
    await expect(rncpContext()).rejects.toMatchObject({ status: 403 });
    expect((await importMatrix(new Request("https://test.invalid", { method: "POST" }))).status).toBe(403);
    expect((await uploadPdf(new Request("https://test.invalid", { method: "POST" }))).status).toBe(403);
    expect(state.privilegedTables).toEqual([]);
  });
  it.each(["inactive", "demo"])("rejects inactive and DEMO identity (%s)", async kind => { if (kind === "inactive") state.profile.status = kind; else state.profile.workspace_mode = kind; await expect(rncpContext()).rejects.toMatchObject({ status: 403 }); expect(state.privilegedTables).toEqual([]); });
  it("allows a live internal reader only after organizational RPC verification", async () => { const context = await rncpContext(); expect(context.organizationId).toBe("org-a"); expect(state.rpc).toEqual(["iq_rncp_actor_org"]); });
  it("rejects module permission revocation and organization mismatches", async () => { state.permitted = false; await expect(rncpContext()).rejects.toMatchObject({ status: 403 }); state.permitted = true; state.scope = "org-b"; await expect(rncpContext()).rejects.toMatchObject({ status: 403 }); });
  it("requires an active administrator profile even with a stale administrator UI session", async () => { state.session!.userType = "Administrador"; await expect(rncpContext("admin")).rejects.toMatchObject({ status: 403 }); expect(state.privilegedTables).toEqual([]); state.profile.user_type = "administrator"; expect((await rncpContext("admin")).profile.user_type).toBe("administrator"); });
  it("reports missing activation explicitly without substituting demo data", async () => { state.scopeError = { code: "PGRST202" }; await expect(rncpContext()).rejects.toMatchObject({ status: 503, message: expect.stringContaining("Activación") }); });
  it("only explicitly allowed endpoints can accept supplier identity", async () => { state.profile.user_type = "supplier"; state.profile.external_party_id = "supplier-a"; state.owner.kind = "supplier"; expect((await rncpContext("update", true)).supplier).toBe(true); await expect(rncpContext("admin", true)).rejects.toMatchObject({ status: 403 }); });
  it("denies direct alert review, settings and evaluation by an internal non-admin", async () => { for (const command of ["config", "review_alert", "evaluate"]) { const result = await followup(new Request("https://test.invalid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) })); expect(result.status).toBe(403); } expect(state.privilegedTables).toEqual([]); });
});

describe("complete stable pagination instead of silent truncation", () => {
  it("loads every record beyond the PostgREST page limit", async () => { const all = Array.from({ length: 1201 }, (_, id) => ({ id: String(id) })); const page = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), count: all.length, error: null })); expect(await paginatedRows(page)).toEqual(all); expect(page).toHaveBeenCalledTimes(3); });
  it("rejects an incomplete page, a changing count or repeated IDs", async () => { await expect(paginatedRows(async () => ({ data: [], count: 1, error: null }))).rejects.toMatchObject({ status: 503 }); let calls = 0; await expect(paginatedRows(async () => ({ data: [{ id: String(calls) }], count: ++calls === 1 ? 3 : 2, error: null }))).rejects.toMatchObject({ status: 409 }); await expect(paginatedRows(async () => ({ data: [{ id: "same" }], count: 2, error: null }))).rejects.toMatchObject({ status: 409 }); });
  it("propagates query errors and absent schema without local fallback", async () => { await expect(paginatedRows(async () => ({ data: null, count: null, error: { message: "missing", code: "42703" } }))).rejects.toMatchObject({ status: 503 }); });
});
