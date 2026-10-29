import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), range: vi.fn(), select: vi.fn(), order: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.client }));
import { loadStoredControlledDocuments } from "./document-storage";
const row = (index: number) => ({ id: `doc-${index}`, process_id: "P-19", document_type_id: "manual", code: `MAN-${index}`, title: `Documento ${index}`, description: null, owner_id: null, owner: null, lifecycle: [], activity: [], versions: [] });
beforeEach(() => {
  vi.resetAllMocks();
  const query = { select: mocks.select, order: mocks.order, range: mocks.range };
  mocks.client.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue(query); mocks.select.mockReturnValue(query); mocks.order.mockReturnValue(query);
});
describe("authoritative document catalog", () => {
  it("loads all 534 authorized rows across pages with explicit relationships", async () => {
    mocks.range.mockResolvedValueOnce({ data: Array.from({ length: 500 }, (_, i) => row(i)), count: 534, error: null });
    mocks.range.mockResolvedValueOnce({ data: Array.from({ length: 34 }, (_, i) => row(i + 500)), count: 534, error: null });
    const documents = await loadStoredControlledDocuments();
    expect(documents).toHaveLength(534);
    expect(mocks.range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(mocks.select.mock.calls[0][0]).toContain("lifecycle:document_lifecycle!document_lifecycle_document_id_fkey(");
    expect(mocks.order).toHaveBeenCalledWith("id", { ascending: true });
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