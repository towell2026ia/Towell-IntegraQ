import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteProcessOrganizationChart, getProcessOrganizationChartUrl, loadProcessOrganizationHistory, uploadProcessOrganizationChart, type ProcessOrganizationSource } from "./organization-chart-storage";
const mock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => mock);
const source = { id: "old", processId: "P-01", bucketId: "private", objectPath: "old.png" } as ProcessOrganizationSource;
function client(results: unknown[]) {
  const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  const from = vi.fn(() => {
    const response = results.shift(), chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is", "order", "limit", "update", "insert"]) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue(response);
    chain.single = vi.fn().mockResolvedValue(response);
    chain.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve));
    chains.push(chain); return chain;
  });
  const upload = vi.fn().mockResolvedValue({ error: null }), remove = vi.fn(), sign = vi.fn().mockResolvedValue({ data: { signedUrl: "signed" } });
  mock.createClient.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin" } } }) }, from, storage: { from: vi.fn(() => ({ upload, remove, createSignedUrl: sign })) } });
  return { chains, upload, remove, sign, from };
}
const admin = { data: { user_type: "administrator", status: "active" }, error: null };
const empty = { data: null, error: null };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("organization chart immutable versions", () => {
  it("uploads a new image after deletion with the next historical version and no position changes", async () => {
    const c = client([admin, empty, { data: { id: "deleted-v4", version: 4 } }, { data: { id: "new" } }]);
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    await uploadProcessOrganizationChart({ file: new File(["image"], "chart.PNG", { type: "application/octet-stream" }), processId: "P-01" });
    expect(c.chains[3].insert).toHaveBeenCalledWith(expect.objectContaining({ version: 5, replaces_file_id: "deleted-v4", preview_status: "not_required", is_current: true }));
    expect(c.upload).toHaveBeenCalledWith(expect.any(String), expect.any(File), expect.objectContaining({ upsert: false }));
    expect(request).not.toHaveBeenCalled();
    expect(c.remove).not.toHaveBeenCalled();
  });
  it("retains the binary when an insert response is uncertain", async () => {
    const c = client([admin, { data: { id: "old", version: 2 } }, { data: { id: "old", version: 2 } }, { data: { id: "old" } }, { data: null, error: { message: "timeout" } }, { data: { id: "new" } }]);
    await expect(uploadProcessOrganizationChart({ file: new File(["image"], "chart.png", { type: "image/png" }), processId: "P-01" })).rejects.toThrow("confirmar");
    expect(c.remove).not.toHaveBeenCalled();
    expect(c.chains).toHaveLength(6);
    expect(c.chains[3].update).toHaveBeenCalledWith({ is_current: false });
  });
  it("requires an active administrator before uploading", async () => {
    const c = client([{ data: { user_type: "user", status: "active" } }]);
    await expect(uploadProcessOrganizationChart({ file: new File(["x"], "chart.png"), processId: "P-01" })).rejects.toThrow("administrador");
    expect(c.upload).not.toHaveBeenCalled();
  });
  it("logically deletes only the current scoped source, with an obligatory reason", async () => {
    const c = client([admin, { data: { id: "old" } }]);
    await expect(deleteProcessOrganizationChart(source, " ")).rejects.toThrow("obligatorio");
    expect(c.from).not.toHaveBeenCalled();
    await deleteProcessOrganizationChart(source, " Nueva estructura ");
    expect(c.chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ is_current: false, deleted_by: "admin", deletion_reason: "Nueva estructura" }));
    expect(c.chains[1].eq.mock.calls).toEqual([["id", "old"], ["resource_type", "process_organization_chart"], ["process_id", "P-01"], ["is_current", true]]);
    expect(c.remove).not.toHaveBeenCalled();
  });
  it("loads historical metadata without excluding replaced or deleted versions", async () => {
    const c = client([{ data: [{ id: "old", process_id: "P-01", original_name: "old.png", is_current: false, deleted_at: "2026-10-01", version: 3 }] }]);
    const history = await loadProcessOrganizationHistory("P-01");
    expect(history[0]).toMatchObject({ id: "old", isCurrent: false, version: 3, deletedAt: "2026-10-01" });
    expect(c.chains[0].eq.mock.calls).toEqual([["resource_type", "process_organization_chart"], ["resource_key", "P-01"], ["process_id", "P-01"]]);
  });
  it("signs the selected historical object freshly for each consultation", async () => {
    const c = client([]);
    await getProcessOrganizationChartUrl(source); await getProcessOrganizationChartUrl(source);
    expect(c.sign).toHaveBeenCalledTimes(2);
    expect(c.sign).toHaveBeenCalledWith("old.png", 120);
  });
});
