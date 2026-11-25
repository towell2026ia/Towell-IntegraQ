import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const state = vi.hoisted(() => ({ session: null as ActiveSession | null,
  profile: { id: "actor", organization_id: "org-a", external_party_id: null as string | null, user_type: "internal", status: "active", workspace_mode: "production" },
  owner: { kind: "internal", active: true }, permitted: true, scope: "org-a", scopeError: null as { code: string } | null,
  privilegedTables: [] as string[], rpc: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({
  getVerifiedSessionContext: async () => state.session && ({
    session: state.session, profile: state.profile,
    supabase: { rpc: async (name: string) => { state.rpc.push(name); return { data: state.scope, error: state.scopeError }; } },
  }),
}));
vi.mock("@/lib/module-permissions", () => ({ canPerformModuleAction: () => state.permitted }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  state.privilegedTables.push(table); const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: state.owner, error: null }) }; return query;
} }) }));

import { loadMatrixOriginalCounts, loadMatrixReports, paginatedRows, reportListRows, rncpContext, type RncpContext } from "./server";
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
  it.each([["42501", 403], ["57014", 503]])("distinguishes a scope rejection from a failed lookup (%s)", async (code, status) => {
    state.scopeError = { code }; await expect(rncpContext()).rejects.toMatchObject({ status });
  });
  it("only explicitly allowed endpoints can accept supplier identity", async () => { state.profile.user_type = "supplier"; state.profile.external_party_id = "supplier-a"; state.owner.kind = "supplier"; expect((await rncpContext("update", true)).supplier).toBe(true); await expect(rncpContext("admin", true)).rejects.toMatchObject({ status: 403 }); });
  it("denies direct alert review, settings and evaluation by an internal non-admin", async () => { for (const command of ["config", "review_alert", "evaluate"]) { const result = await followup(new Request("https://test.invalid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }) })); expect(result.status).toBe(403); } expect(state.privilegedTables).toEqual([]); });
});

describe("complete stable pagination instead of silent truncation", () => {
  it("accepts a complete first page and falls back to counted pagination for a capped response", async () => {
    const first = async () => ({ data: [{ id: "a" }], error: null });
    const tail = vi.fn().mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [{ id: "b" }], error: null });
    const complete = vi.fn(async () => [{ id: "a" }, { id: "b" }]);
    expect(await reportListRows(first, tail, complete)).toEqual([{ id: "a" }]);
    expect(complete).not.toHaveBeenCalled();
    expect(await reportListRows(first, tail, complete)).toEqual([{ id: "a" }, { id: "b" }]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(tail).toHaveBeenCalledWith("a");
    await expect(reportListRows(first, async () => ({ data: null, error: { code: "57014" } }), complete))
      .rejects.toMatchObject({ status: 503 });
  });
  it("loads every record beyond the PostgREST page limit", async () => { const all = Array.from({ length: 1201 }, (_, id) => ({ id: String(id) })); const page = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), count: all.length, error: null })); expect(await paginatedRows(page)).toEqual(all); expect(page).toHaveBeenCalledTimes(3); });
  it("rejects an incomplete page, a changing count or repeated IDs", async () => { await expect(paginatedRows(async () => ({ data: [], count: 1, error: null }))).rejects.toMatchObject({ status: 503 }); let calls = 0; await expect(paginatedRows(async () => ({ data: [{ id: String(calls) }], count: ++calls === 1 ? 3 : 2, error: null }))).rejects.toMatchObject({ status: 409 }); await expect(paginatedRows(async () => ({ data: [{ id: "same" }], count: 2, error: null }))).rejects.toMatchObject({ status: 409 }); });
  it("propagates query errors and absent schema without local fallback", async () => { await expect(paginatedRows(async () => ({ data: null, count: null, error: { message: "missing", code: "42703" } }))).rejects.toMatchObject({ status: 503 }); });
});

describe("dashboard projections and deferred PDF counts", () => {
  function fixture() {
    const historical = { id: "a", source_kind: "historical", notified_at: "2026-10-01", complete_submitted_at: "2026-10-02" };
    const draft = { id: "b", source_kind: "native", notified_at: null };
    const submitted = { id: "c", source_kind: "native", notified_at: "2026-10-01", complete_submitted_at: "2026-10-02" };
    const reports = [historical, draft, submitted].map(row => ({ ...row, organization_id: "org-a" }));
    const files = [1, 2].map(version => ({ id: "file-" + version, resource_id: "a", version, original_name: "revision.pdf" }));
    const reads: Array<{ table: string; fields: string }> = [];
    function from(table: string) {
      let rows: Array<{ id: string }> = table === "file_objects" ? files : reports;
      const builder = {
        select(fields: string) { reads.push({ table, fields }); return builder; },
        eq(field: string, value: string) { if (field === "id") rows = rows.filter(row => row.id === value); return builder; },
        is() { return builder; }, order() { return builder; },
        in(field: string, ids: string[]) { if (field === "id") rows = rows.filter(row => ids.includes(row.id)); if (field === "resource_id") rows = files.filter(f => ids.includes(f.resource_id)); return builder; },
        gt(_field: string, id: string) { rows = rows.filter(row => row.id > id); return builder; },
        limit(size: number) { return Promise.resolve({ data: rows.slice(0, size), error: null }); },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        range() { return Promise.resolve({ data: rows, count: rows.length, error: null }); }
      };
      return builder;
    }
    const rpc = vi.fn(async (_name: string, args: { p_report_ids: string[] }) =>
      ({ data: Object.fromEntries(args.p_report_ids.map(id => [id, []])), error: null }));
    const context = { supabase: { from, rpc }, admin: { from }, profile: { user_type: "internal" }, organizationId: "org-a", supplier: false } as unknown as RncpContext;
    return { context, reads, rpc };
  }

  it("loads charts without PDF reads and checks only reports whose lifecycle needs evidence", async () => {
    const { context, reads, rpc } = fixture();
    const rows = await loadMatrixReports(context, undefined, true);
    expect(rows.map(r => r.id)).toEqual(["a", "b", "c"]);
    expect(rows.every(r => r.originalFileCount === undefined && r.originalFiles.length === 0)).toBe(true);
    expect(reads.map(read => read.table)).toEqual(["supplier_rncp_reports", "supplier_rncp_reports"]);
    expect(reads[1].fields).toBe("id");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("iq_rncp_requirements_summary", { p_report_ids: ["c"] });
    expect(rows[2].requirementsComplete).toBe(true);
  });

  it("counts versions once and retrieves metadata and authoritative requirements only on opening", async () => {
    const { context, reads, rpc } = fixture();
    expect(await loadMatrixOriginalCounts(context)).toEqual({ a: 2, b: 0, c: 0 });
    expect(await loadMatrixOriginalCounts(context, ["a", "missing"])).toEqual({ a: 2 });
    expect(reads).toContainEqual({ table: "file_objects", fields: "id,resource_id" });
    expect(rpc).not.toHaveBeenCalled();
    const [detail] = await loadMatrixReports(context, "a");
    expect(detail.originalFiles.map(f => f.version)).toEqual([2, 1]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("iq_rncp_requirements_summary", { p_report_ids: ["a"] });
  });

  it("denies detail when a scoped read returns a foreign organization before any file lookup", async () => {
    const { context, reads, rpc } = fixture();
    await expect(loadMatrixReports({ ...context, organizationId: "org-b" }, "a")).rejects.toMatchObject({ status: 403 });
    expect(reads.map(read => read.table)).toEqual(["supplier_rncp_reports"]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects a missing report before privileged reads and keeps global counts internal", async () => {
    const { context, reads } = fixture();
    await expect(loadMatrixReports(context, "missing")).rejects.toMatchObject({ status: 404 });
    await expect(loadMatrixOriginalCounts({ ...context, supplier: true })).rejects.toMatchObject({ status: 403 });
    expect(reads.every(read => read.table !== "file_objects")).toBe(true);
  });
});
