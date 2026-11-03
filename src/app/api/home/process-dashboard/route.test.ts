import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession } from "@/lib/session-data";
const state = vi.hoisted(() => ({ session: null as unknown, rows: {} as Record<string, Record<string, unknown>[]>, fail: "", calls: [] as string[], authenticatedTables: [] as string[] }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
function query(table: string) {
  state.calls.push(table);
  let rows = state.rows[table] ?? []; let count = rows.length;
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; },
    in: (key: string, values: unknown[]) => { rows = rows.filter(r => values.includes(r[key])); return q; },
    is: (key: string, value: unknown) => { rows = rows.filter(r => (r[key] ?? null) === value); return q; },
    order: () => q,
    range: (start: number, end: number) => { count = rows.length; rows = rows.slice(start, end + 1); return q; },
    maybeSingle: async () => ({ data: rows[0], error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, count, error: state.fail === table ? { code: "failure" } : null }),
  }; return q;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => { state.authenticatedTables.push(table); return query(table); }, rpc: async () => ({ data: true }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://test/image" }, error: null }) }) } }) }));
import { GET } from "./route";
beforeEach(() => {
  state.calls = []; state.authenticatedTables = []; state.fail = "";
  state.session = { ...activeSession, authUserId: "user", workspaceMode: "production" };
  state.rows = { profiles: [{ id: "user", status: "active", user_type: "administrator", organization_id: "org", workspace_mode: "production" }], processes: [{ id: "quality", name: "Calidad", organization_id: "org", active: true }, { id: "foreign", name: "Ajeno", organization_id: "other", active: true }] };
});
describe("API de Inicio: alcance en servidor", () => {
  it("administrador sólo recibe procesos de su organización", async () => {
    const response = await GET(new Request("https://test/api/home/process-dashboard"));
    expect(response.status).toBe(200);
    expect((await response.json()).dashboard.processScope.ids).toEqual(["quality"]);
    expect(state.authenticatedTables).toEqual(expect.arrayContaining(["controlled_documents", "indicator_definitions", "corrective_actions", "audits", "measurement_assets"]));
  });
  it("usuario interno sólo recibe sus procesos persistidos", async () => {
    state.session = { ...activeSession, authUserId: "user", userType: "Usuario interno", assignedModuleIds: ["home"], assignedProcessIds: ["foreign"] };
    state.rows.profiles[0].user_type = "internal";
    expect((await (await GET(new Request("https://test/api/home/process-dashboard"))).json()).dashboard.processScope.ids).toEqual([]);
  });
  it.each(["Cliente", "Proveedor"])("deniega el portal %s antes de usar credenciales privilegiadas", async userType => {
    state.session = { ...activeSession, authUserId: "user", userType };
    expect((await GET(new Request("https://test"))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });
  it("deniega al interno sin Inicio", async () => {
    state.session = { ...activeSession, authUserId: "user", userType: "Usuario interno", assignedModuleIds: [], moduleActionPermissions: [] };
    expect((await GET(new Request("https://test"))).status).toBe(403);
  });
  it("un error no devuelve datos locales ni un catálogo parcialmente exitoso", async () => {
    state.fail = "processes";
    expect((await GET(new Request("https://test"))).status).toBe(503);
  });
  it("un filtro no permite pedir otra organización", async () => {
    const response = await GET(new Request("https://test/api/home/process-dashboard?processId=foreign&organization_id=other"));
    expect((await response.json()).dashboard.processScope.ids).toEqual([]);
  });
  it("carga más de una página sin truncar el conteo documental", async () => {
    state.rows.controlled_documents = Array.from({ length: 501 }, (_, i) => ({ id: `doc-${i}`, process_id: "quality", organization_id: "org", code: `DOC-${i}`, title: `Documento ${i}`, active: true, deleted_at: null }));
    state.rows.controlled_document_versions = state.rows.controlled_documents.map(d => ({ id: `v-${d.id}`, document_id: d.id, revision: 1, status: "current" }));
    const response = await GET(new Request("https://test"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.dashboard.documentMetrics.find((m: { id: string }) => m.id === "current").value).toBe(501);
    expect(state.authenticatedTables.filter(table => table === "controlled_documents")).toHaveLength(2);
  });
  it("comparte la misma imagen vigente con internos sin permiso de edición ni proceso documental", async () => {
    state.rows.controlled_documents = [{ id: "doc", organization_id: "org", process_id: "quality", title: "Política de Calidad", active: true, deleted_at: null }];
    state.rows.controlled_document_versions = [{ id: "version", document_id: "doc", revision: 1, status: "current", file_id: "file", file_name: "Política de Calidad.png", updated_at: "2026-11-03T12:00:00Z" }];
    state.rows.file_objects = [{ id: "file", bucket_id: "private", object_path: "image.png", mime_type: "image/png", deleted_at: null }];
    const administrator = await (await GET(new Request("https://test"))).json();
    state.session = { ...activeSession, authUserId: "user", userType: "Usuario interno", assignedModuleIds: ["home"], assignedProcessIds: [] };
    state.rows.profiles[0].user_type = "internal";
    const internal = await (await GET(new Request("https://test"))).json();
    expect(internal.imageDocuments).toEqual(administrator.imageDocuments);
    expect(internal.imageDocuments).toHaveLength(1);
    expect(internal.dashboard.pendingTasks).toEqual([]);
  });
});
