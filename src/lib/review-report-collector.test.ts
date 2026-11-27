import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type ActiveSession, activeSession } from "./session-data";
vi.mock("server-only", () => ({}));
import { collectReview } from "./review-report-collector";

const admin: ActiveSession = {
  ...activeSession,
  userType: "Administrador",
  workspaceMode: "production",
  organizationId: "tenant",
  authUserId: "actor",
};
// Local test adapter for the PostgREST reader. It only implements read operations.
function fixture(failingTable?: string) {
  const filters: string[] = [];
  function from(table: string) {
    const q = {
      select: () => q,
      order: () => q,
      eq: (field: string, v: unknown) => {
        filters.push(table + "." + field + "=" + v);
        return q;
      },
      is: () => q,
      like: () => q,
      gte: () => q,
      lte: () => q,
      async range() {
        if (table === failingTable) {
          return { data: null, error: { code: "57014" } };
        }
        const data = table === "supplier_rncp_reports"
          ? ["Cerrado", "Tarde", "Tarde"].map((historical_status, i) => ({
            id: "r" + i,
            status: "closed",
            source_kind: "historical",
            historical_status,
          }))
          : table === "indicator_periods"
          ? ["Q1", "Q2"].map((quarter, i) => ({
            id: "p" + i,
            indicator_id: "i",
            quarter,
            scheduled_date: "2025-0" + (i + 1) + "-01",
            definition: {
              code: "I",
              quality_objective: null,
              process_id: "P",
              metric_label: "Resultado",
              rule: { unit: "%", target_value: 90 },
            },
            result: i
              ? {
                id: "res",
                evaluation_status: "compliant",
                value: 94,
                evidence_file_id: "file",
              }
              : null,
          }))
          : [];
        return { data, error: null };
      },
    };
    return q;
  }
  return { db: { from } as unknown as SupabaseClient, filters };
}
describe("Recopilador RE-05", () => {
  it("lee desde el alcance productivo y conserva reglas, nulos, períodos y fuentes pendientes", async () => {
    const { db, filters } = fixture();
    const snapshot = await collectReview(
      db,
      admin,
      2025,
      new Date("2026-08-05T03:00:00Z"),
    );
    expect(snapshot.sources).toHaveLength(18);
    expect(filters).toContain("supplier_rncp_reports.organization_id=tenant");
    expect(filters).toContain(
      "indicator_periods.definition.workspace_mode=production",
    );
    const src = (id: string) => snapshot.sources.find((s) => s.id === id)!;
    expect(src("suppliers").metrics[1]).toMatchObject({
      numerator: 1,
      denominator: 3,
    });
    expect(src("outputs").metrics.at(-1)?.value).toBeNull();
    expect(src("objectives").evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 90, unit: "%" }),
        expect.objectContaining({ value: 94, fileId: "file" }),
      ]),
    );
    expect(
      src("objectives").metrics.find((m) =>
        m.label === "Aumento en la última medición"
      )?.value,
    ).toBe(0);
    expect(src("customers").status).toBe("empty");
    expect(src("satisfaction").status).toBe("pending");
    expect(src("documents").period).toMatch(/2026-08-04/);
    expect(src("suppliers").period).toContain("2025-12-31");
    const current = await collectReview(
      db,
      admin,
      2026,
      new Date("2026-08-05T03:00:00Z"),
    );
    expect(current.sources.find((s) => s.id === "suppliers")?.period).toContain(
      "2026-08-04",
    );
    expect(current.fingerprint).not.toBe(snapshot.fingerprint);
  });
  it("aísla el fallo de una fuente sin producir falsos ceros", async () => {
    const { db } = fixture("indicator_periods");
    const s = await collectReview(db, admin, 2025);
    expect(s.sources.find((x) => x.id === "objectives")).toMatchObject({
      status: "error",
      metrics: [],
    });
    expect(s.sources.find((x) => x.id === "suppliers")?.status).toBe(
      "available",
    );
  });
  it.each(["Cliente", "Proveedor", "Usuario interno"] as const)(
    "deniega recopilar a %s antes de leer",
    async (userType) => {
      const { db, filters } = fixture();
      await expect(collectReview(db, { ...admin, userType }, 2025)).rejects
        .toThrow();
      expect(filters).toHaveLength(0);
    },
  );
});
