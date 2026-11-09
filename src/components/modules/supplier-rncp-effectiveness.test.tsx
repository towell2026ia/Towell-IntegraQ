import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RncpReport } from "@/lib/rncp-data";
import type { ActiveSession } from "@/lib/session-data";
const fixture = vi.hoisted(() => ({ reports: [] as RncpReport[], loading: false, error: "" }));
vi.mock("@/hooks/use-rncp-reports", () => ({ useRncpReports: () => ({ ...fixture, refresh: vi.fn() }) }));
vi.mock("@/hooks/use-external-companies", () => ({ useExternalCompanies: () => ({ companies: [
  { id: "supplier-a", code: "TEST-A", name: "Synthetic supplier", kind: "supplier", active: true },
], loading: false, error: "", refresh: vi.fn() }) }));
vi.mock("@/hooks/use-supplier-audits", () => ({ useSupplierAudits: () => ({ data: null, loading: false, error: "", refresh: vi.fn() }) }));
vi.mock("@/lib/session-data", async importOriginal => ({ ...await importOriginal<object>(), isAdministrator: () => true, isDemoSession: () => false }));
vi.mock("@/lib/module-permissions", () => ({ canPerformModuleAction: () => true }));
vi.mock("./document-preview-viewer", () => ({ DocumentPreviewViewer: () => null }));
import { SuppliersModule } from "./suppliers-module";
function report(id: string, historicalStatus = "Cerrado"): RncpReport {
  return { id, folio: id, supplierId: "supplier-a", origin: "historical", historicalStatus,
    status: historicalStatus === "Cerrado" ? "closed" : "in_progress", late: historicalStatus === "Tarde",
    portalVisible: false, history: [], actions: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" };
}
const render = () => renderToStaticMarkup(createElement(SuppliersModule, { session: { authUserId: "synthetic-admin", organizationId: "org-a" } as ActiveSession }));
describe("supplier effectiveness card", () => {
  it("shows the 75% calculation and distinguishes original historical category from punctual closure", () => {
    fixture.reports = [report("1"), report("2"), report("3"), report("4", "Tarde")];
    fixture.loading = false; fixture.error = "";
    const html = render();
    expect(html).toContain("Efectividad RNCP</small><strong>75 %");
    expect(html).toContain("3 cerrados / (3 cerrados + 1 tardíos)");
    expect(html).toContain("«Cerrado» histórico no acredita cierre puntual.");
    expect(html).toContain("4 evaluables");
  });
  it("shows Sin RNCP evaluables rather than Pendiente without eligible rows", () => {
    fixture.reports = [report("1", "En Proceso")];
    expect(render()).toContain("Sin RNCP evaluables");
  });
  it("does not turn unavailable data into a calculated percentage or empty evaluated set", () => {
    fixture.loading = false; fixture.error = "Read denied";
    expect(render()).toContain("Efectividad RNCP</small><strong>No disponible");
    fixture.error = ""; fixture.loading = true;
    expect(render()).toContain("Consultando RNCP…");
    fixture.loading = false;
  });
});
