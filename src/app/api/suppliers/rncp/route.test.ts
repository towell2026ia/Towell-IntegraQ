import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ session: vi.fn(), filters: [] as Array<{ table: string; field: string; ids: string[] }>, rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: state.session }));
function client() { return { from(table: string) {
  const query = { select: () => query, order: () => query, eq: () => query,
    in: (field: string, ids: string[]) => { state.filters.push({ table, field, ids }); return query; },
    range: async () => ({ data: table === "supplier_rncp_reports" ? state.rows : [], count: table === "supplier_rncp_reports" ? state.rows.length : 0, error: null }) };
  return query;
} }; }
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client() }));
vi.mock("@/lib/rncp/server", () => ({ paginatedRows: async (page: (a: number, b: number) => Promise<{ data: unknown[] }>) => (await page(0, 499)).data, RncpError: class extends Error { status = 400; } }));
import { GET } from "./route";
beforeEach(() => {
  state.session.mockResolvedValue({ authUserId: "admin" }); state.filters = [];
  state.rows = [{ id: "authorized-report", folio: "TEST-1", supplier_id: "supplier-a", supplier: { code: "TEST-A", name: "Synthetic supplier" },
    source_kind: "historical", historical_status: "Cerrado", status: "closed", complete_submitted_at: null,
    validated_at: null, validation_outcome: null, closed_at: null }];
});
describe("RNCP effectiveness source fields", () => {
  it("preserves the original historical category without inventing response dates", async () => {
    const response = await GET(), data = await response.json();
    expect(response.status).toBe(200);
    expect(data.reports[0]).toMatchObject({ origin: "historical", historicalStatus: "Cerrado" });
    expect(data.reports[0].completeSubmittedAt).toBeUndefined();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("exposes stored native response and validation timestamps without deriving them from late", async () => {
    state.rows[0] = { ...state.rows[0], source_kind: "native", historical_status: null,
      notified_at: "2026-10-01T18:00:00Z", response_deadline: "2026-10-08T18:00:00Z",
      complete_submitted_at: "2026-10-09T18:00:00Z", validated_at: "2026-10-10T18:00:00Z", validation_outcome: "accepted" };
    const data = await (await GET()).json();
    expect(data.reports[0]).toMatchObject({ completeSubmittedAt: "2026-10-09T18:00:00Z",
      validatedAt: "2026-10-10T18:00:00Z", validationOutcome: "accepted" });
    expect(state.filters.filter(f => f.table === "audit_log" || f.table === "supplier_rncp_actions")
      .every(f => f.ids.length === 1 && f.ids[0] === "authorized-report")).toBe(true);
  });
  it("denies missing sessions before reading source fields", async () => {
    state.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(state.filters).toEqual([]);
  });
});
