import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type ActiveSession, activeSession } from "./session-data";
vi.mock("server-only", () => ({}));
import { qualityPolicyDocumentId } from "./quality-policy";
import { collectReview } from "./review-report-collector";

const admin: ActiveSession = {
  ...activeSession,
  userType: "Administrador",
  workspaceMode: "production",
  organizationId: "tenant",
  authUserId: "actor",
};
// Local test adapter for the PostgREST reader. It only implements read operations.
type DocFixture = {
  id: string; code: string; process_id: string; organization_id: string | null; process: { organization_id: string };
  active: boolean; deleted_at: null; lifecycle: { is_deleted: boolean; lifecycle_status: string } | null;
  versions: { id: string; status: string; revision: number }[];
};
function fixture(failingTable?: string, docs: DocFixture[] = []) {
  const filters: string[] = [];
  function from(table: string) {
    const where: Record<string, unknown> = {};
    let scope = "";
    const q = {
      select: (columns: string) => {
        if (table === "controlled_documents" && columns.includes("document_lifecycle!")) {
          expect(columns).toContain("process:processes!controlled_documents_process_id_fkey!inner(organization_id)");
        }
        return q;
      },
      order: () => q,
      eq: (field: string, v: unknown) => {
        where[field] = v;
        filters.push(table + "." + field + "=" + v);
        return q;
      },
      is: (field: string, value: unknown) => { where[field] = value; return q; },
      or: (condition: string) => { scope = condition; return q; },
      async maybeSingle() {
        expect(where).toMatchObject({ id: qualityPolicyDocumentId, code: "AV-SGC-0", process_id: "P-35",
          "process.organization_id": "tenant", active: true, deleted_at: null, "versions.status": "current" });
        expect(scope).toBe("organization_id.is.null,organization_id.eq.tenant");
        if (table === failingTable) return { data: null, error: { code: "42501" } };
        const data = docs.find(d => d.id === where.id && d.code === where.code && d.process_id === where.process_id &&
          d.active && !d.deleted_at && d.process.organization_id === where["process.organization_id"] &&
          (d.organization_id === null || d.organization_id === "tenant"));
        return { data, error: null };
      },
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
          : table === "controlled_documents" ? docs.filter(d => d.organization_id === where.organization_id)
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
  it("vincula la revisión vigente institucional sin incluirla en el catálogo general de la organización", async () => {
    const policy: DocFixture = { id: qualityPolicyDocumentId, code: "AV-SGC-0", process_id: "P-35", organization_id: null,
      process: { organization_id: "tenant" }, active: true, deleted_at: null, lifecycle: null,
      versions: [{ id: "old", revision: 1, status: "obsolete" }, { id: "official", revision: 2, status: "current" }] };
    const manual = { ...policy, id: "b5b1c30d-da00-593c-abb7-15832857ef5c", code: "M-SGC-01", organization_id: "tenant",
      versions: [{ id: "waiting", revision: 1, status: "pending" }] };
    const { db } = fixture(undefined, [policy, manual, { ...policy, id: "other-null" }]);
    const read = async () => (await collectReview(db, admin, 2025)).sources;
    const before = await read();
    expect(before.find(s => s.id === "policy")).toMatchObject({ status: "available",
      evidence: [expect.objectContaining({ label: "AV-SGC-0", recordId: policy.id, id: "official" })],
      records: ["policy:" + policy.id, "policy:official"], metrics: [expect.objectContaining({ value: 2 })] });
    expect(before.find(s => s.id === "documents")?.records).toEqual(["documents:" + manual.id]);
    expect(before.find(s => s.id === "manual")?.metrics[0].label).toBe("Revisión en validación");
    policy.versions[1].status = "obsolete";
    policy.versions.push({ id: "new", revision: 3, status: "current" });
    expect((await read()).find(s => s.id === "policy")?.records).toContain("policy:new");
    policy.lifecycle = { is_deleted: false, lifecycle_status: "obsolete" };
    expect((await read()).find(s => s.id === "policy")?.status).toBe("empty");
    policy.lifecycle = null;
    policy.organization_id = "other";
    expect((await read()).find(s => s.id === "policy")?.status).toBe("empty");
    policy.organization_id = null;
    policy.process.organization_id = "other";
    expect((await read()).find(s => s.id === "policy")?.status).toBe("empty");
    const denied = await collectReview(fixture("controlled_documents").db, admin, 2025);
    expect(denied.sources.find(s => s.id === "policy")).toMatchObject({ status: "forbidden", records: [] });
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
