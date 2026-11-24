import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), range: vi.fn(), select: vi.fn(), order: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.client }));
import { loadStoredControlledDocument, loadStoredControlledDocuments } from "./document-storage";
const relatedRows: Record<string, Record<string, unknown>[]> = {};
const relationFilter = vi.fn();
const row = (index: number) => ({ id: `doc-${index}`, process_id: "P-19", document_type_id: "manual", code: `MAN-${index}`, title: `Documento ${index}`, description: null, owner_id: null, owner: null, lifecycle: [], activity: [], versions: [] });
beforeEach(() => {
  vi.resetAllMocks();
  const query = { select: mocks.select, order: mocks.order, range: mocks.range };
  mocks.client.mockReturnValue({ from: mocks.from });
  for (const key of Object.keys(relatedRows)) delete relatedRows[key];
  relationFilter.mockReset();
  mocks.from.mockImplementation((table: string) => {
    if (table === "controlled_documents") return query;
    return { select: () => ({
      in: (column: string, ids: string[]) => {
        relationFilter(table, column, ids);
        const data = (relatedRows[table] ?? []).filter(r => ids.includes(r[column] as string));
        return { order: () => ({ range: async (a: number, b: number) => ({ data: data.slice(a, b + 1), count: data.length, error: null }) }) };
      },
    }) };
  }); mocks.select.mockReturnValue(query); mocks.order.mockReturnValue(query);
});
describe("authoritative document catalog", () => {
  it("loads all 534 authorized rows across pages without embedded relations", async () => {
    mocks.range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, i) => row(i)), count: 534, error: null });
    mocks.range.mockResolvedValueOnce({ data: Array.from({ length: 34 }, (_, i) => row(i + 500)), count: 534, error: null });
    const documents = await loadStoredControlledDocuments();
    expect(documents).toHaveLength(534);
    expect(mocks.range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(mocks.select.mock.calls[0][0]).not.toMatch(/profiles|lifecycle|versions/);
    expect(relationFilter.mock.calls.every(([, , ids]) => ids.length <= 100)).toBe(true);
    expect(mocks.order).toHaveBeenCalledWith("id", { ascending: true });
  });
  it("keeps audit and file authorization off the catalog path", async () => {
    mocks.range.mockResolvedValue({ data: [row(1)], count: 1, error: null });
    const [document] = await loadStoredControlledDocuments();
    expect(document.catalogSummary).toBe(true);
    const columns = mocks.select.mock.calls[0][0];
    expect(columns).not.toMatch(/document_audit_log|file_objects|object_path|sha256/);
  });
  it("reads one authorized record for history and file details", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row(7), error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    mocks.select.mockReturnValue({ eq });
    const document = await loadStoredControlledDocument("doc-7");
    expect(document.id).toBe("doc-7");
    expect(document.catalogSummary).toBeUndefined();
    expect(eq).toHaveBeenCalledWith("id", "doc-7");
    expect(mocks.select.mock.calls[0][0]).toMatch(/document_audit_log/);
    expect(mocks.select.mock.calls[0][0]).toMatch(/file_objects/);
    expect(mocks.range).not.toHaveBeenCalled();
  });
  it("surfaces denied or missing details without losing the catalog", async () => {
    const eq = vi.fn().mockReturnValue({ maybeSingle: async () => ({ data: null, error: null }) });
    mocks.select.mockReturnValue({ eq });
    await expect(loadStoredControlledDocument("missing")).rejects.toThrow("no está disponible");
  });
  it("continues when the server page cap is smaller than the requested range", async () => {
    mocks.range.mockResolvedValueOnce({ data: [row(0)], count: 2, error: null }).mockResolvedValueOnce({ data: [row(1)], count: 2, error: null });
    expect(await loadStoredControlledDocuments()).toHaveLength(2);
    expect(mocks.range).toHaveBeenLastCalledWith(1, 500);
  });
  it("preserves a truly empty authorized result", async () => {
    mocks.range.mockResolvedValue({ data: [], count: 0, error: null });
    expect(await loadStoredControlledDocuments()).toEqual([]);
  });
  it("propagates the server error code instead of accepting local data", async () => {
    mocks.range.mockResolvedValue({ data: null, count: null, error: { code: "PGRST201", message: "Ambiguous relationship" } });
    await expect(loadStoredControlledDocuments()).rejects.toThrow("PGRST201");
  });
  it("does not return the first page when a later page fails", async () => {
    mocks.range.mockResolvedValueOnce({ data: [row(0)], count: 2, error: null }).mockResolvedValueOnce({ data: null, count: null, error: { code: "42501", message: "permission denied" } });
    await expect(loadStoredControlledDocuments()).rejects.toThrow("42501");
  });
  it("rejects a missing page instead of silently truncating the catalog", async () => {
    mocks.range.mockResolvedValue({ data: [], count: 2, error: null });
    await expect(loadStoredControlledDocuments()).rejects.toThrow("incompleto");
  });
  it("rejects unrecognized types instead of dropping authorized records", async () => {
    mocks.range.mockResolvedValue({ data: [{ ...row(0), document_type_id: "unknown" }], count: 1, error: null });
    await expect(loadStoredControlledDocuments()).rejects.toThrow("Tipo documental no reconocido");
  });
  it("rejects a changing catalog between pages", async () => {
    mocks.range.mockResolvedValueOnce({ data: [row(0)], count: 2, error: null }).mockResolvedValueOnce({ data: [row(1)], count: 3, error: null });
    await expect(loadStoredControlledDocuments()).rejects.toThrow("cambió");
  });
});
it("preserves singleton lifecycle deletion and the 532 active records", async () => {
  const rows = Array.from({ length: 534 }, (_, i) => ({ ...row(i), lifecycle: { lifecycle_status: i < 2 ? "deleted" : "active", is_deleted: i < 2, deleted_at: i < 2 ? "2026-10-01" : null } }));
  mocks.range.mockResolvedValueOnce({ data: rows.slice(0, 500), count: 534, error: null }).mockResolvedValueOnce({ data: rows.slice(500), count: 534, error: null });
  relatedRows.document_lifecycle = rows.map(r => ({ document_id: r.id, ...r.lifecycle }));
  const documents = await loadStoredControlledDocuments();
  expect(documents).toHaveLength(534);
  expect(documents.filter(document => !document.lifecycle?.isDeleted)).toHaveLength(532);
});
it("joins lifecycle, versions and referenced profiles only within the authorized catalog", async () => {
  mocks.range.mockResolvedValueOnce({ data: [{ ...row(1), owner_id: "owner" }, row(2)], count: 2, error: null });
  relatedRows.controlled_document_versions = [
    { id: "v1", document_id: "doc-1", updated_at: "2026-10-01", uploaded_by: "owner", validator_id: "validator", revision: 1, status: "current" },
    { id: "v2", document_id: "outside", uploaded_by: "outside-user" },
  ];
  relatedRows.profiles = [{ id: "owner", full_name: "Titular" }, { id: "validator", full_name: "Validador" }];
  const [first, second] = await loadStoredControlledDocuments();
  expect(first.owner).toBe("Titular");
  expect(first.versions).toMatchObject([{ id: "v1", uploadedBy: "Titular", validator: "Validador" }]);
  expect(second.versions).toEqual([]);
  expect(relationFilter.mock.calls).toEqual([
    ["document_lifecycle", "document_id", ["doc-1", "doc-2"]],
    ["controlled_document_versions", "document_id", ["doc-1", "doc-2"]],
    ["profiles", "id", ["owner", "validator"]],
  ]);
});

it("keeps authorized documents available when profile names cannot load", async () => {
  mocks.range.mockResolvedValueOnce({ data: [{ ...row(1), owner_id: "owner" }], count: 1, error: null });
  relationFilter.mockImplementation((table: string) => {
    if (table === "profiles") throw new Error("57014");
  });
  const documents = await loadStoredControlledDocuments();
  expect(documents).toMatchObject([{ id: "doc-1", ownerId: "owner", owner: "Nombre no disponible" }]);
});

it("reports a lifecycle query error instead of displaying unverified active documents", async () => {
  mocks.range.mockResolvedValueOnce({ data: [row(1)], count: 1, error: null });
  relationFilter.mockImplementation((table: string) => {
    if (table === "document_lifecycle") throw new Error("57014");
  });
  await expect(loadStoredControlledDocuments()).rejects.toThrow("57014");
});

it("delivers only verified active documents before the global count and name resolution", async () => {
  const first = { ...row(1), owner_id: "owner" };
  const early = [first, row(2), row(3)];
  const stillLoading = vi.fn();
  relatedRows.document_lifecycle = [
    { document_id: first.id, lifecycle_status: "active", is_deleted: false },
    { document_id: "doc-2", lifecycle_status: "deleted", is_deleted: true },
  ];
  relatedRows.profiles = [{ id: "owner", full_name: "Titular" }];
  mocks.select.mockImplementation((_projection, options) => {
    if (options?.head) {
      expect(stillLoading).toHaveBeenCalledTimes(1);
      return Promise.resolve({ count: 4, error: null });
    }
    return { order: mocks.order };
  });
  mocks.range.mockResolvedValueOnce({ data: early, count: null, error: null })
    .mockResolvedValueOnce({ data: [row(4)], count: 4, error: null });
  const documents = await loadStoredControlledDocuments(page => {
    expect(page.map(d => d.id)).toEqual([first.id]);
    expect(relationFilter.mock.calls.some(([table]) => table === "profiles")).toBe(false);
    stillLoading();
  });
  expect(mocks.range.mock.calls).toEqual([[0, 11], [3, 502]]);
  expect(documents.map(d => d.id)).toEqual(["doc-1", "doc-2", "doc-3", "doc-4"]);
  expect(documents[0].owner).toBe("Titular");
});

it("does not expose a first page when the lifecycle lookup fails", async () => {
  mocks.range.mockResolvedValueOnce({ data: [row(1)], count: null, error: null });
  relationFilter.mockImplementation((table: string) => {
    if (table === "document_lifecycle") throw new Error("57014");
  });
  const firstPage = vi.fn();
  await expect(loadStoredControlledDocuments(firstPage)).rejects.toThrow("57014");
  expect(firstPage).not.toHaveBeenCalled();
});
