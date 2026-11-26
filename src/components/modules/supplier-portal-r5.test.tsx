import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StakeholderPortalModule } from "./stakeholder-portal-module";
import { activeSession, type ActiveSession } from "@/lib/session-data";
import type { RncpReport } from "@/lib/rncp-data";
const fixture = vi.hoisted(() => ({ reports: [] as RncpReport[] }));
vi.mock("@/hooks/use-rncp-reports", () => ({
  useRncpReports: () => ({
    ...fixture,
    loading: false,
    error: "",
    refresh: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-supplier-assessments", () => ({
  useSupplierAssessments: () => ({
    assessments: [],
    loading: false,
    error: "",
  }),
}));
function page(userType: ActiveSession["userType"], access = true) {
  const session: ActiveSession = {
    ...activeSession,
    authUserId: "user-a",
    workspaceMode: "production",
    userType,
    specificPermissions: { "portal_proveedores.acceder": access },
    externalParty:
      userType === "Proveedor"
        ? {
            kind: "supplier",
            companyId: "a",
            companyName: "Empresa A",
            siteId: "north",
          }
        : undefined,
  };
  return renderToStaticMarkup(
    <StakeholderPortalModule session={session} kind="supplier" actions={[]} />,
  );
}
describe("U07-R5 portal entry", () => {
  it("requires an administrator for the internal selector and starts without an expediente", () => {
    expect(page("Administrador")).toContain("Seleccionar proveedor");
    expect(page("Administrador")).not.toContain("Usuarios con acceso");
    expect(page("Usuario interno")).toContain("Acceso no disponible");
  });
  it("respects an explicit denial and renders published records for the current calendar year", () => {
    const now = new Date().getFullYear();
    const item: RncpReport = {
      late: false,
      createdAt: "2020-01-01",
      updatedAt: "2020-01-01",
      id: "entry",
      folio: "RNCP-EJEMPLO",
      reportDate: now + "-01-16",
      status: "closed",
      origin: "historical",
      historicalStatus: "Cerrado",
      supplierId: "a",
      portalVisible: true,
      actions: [],
      history: [],
    };
    fixture.reports = [
      item,
      { ...item, id: "old", folio: "OTRO-AÑO", reportDate: "2020-01-15" },
      { ...item, id: "b", supplierId: "b", folio: "OTRA-EMPRESA" },
      { ...item, id: "hidden", portalVisible: false, folio: "PRIVADO" },
    ];
    const html = page("Proveedor");
    expect(html).toContain(item.folio);
    expect(html).toContain("Mis evidencias");
    expect(html).not.toMatch(
      /OTRO-AÑO|OTRA-EMPRESA|PRIVADO|Seleccionar proveedor/,
    );
    expect(page("Proveedor", false)).toContain("Acceso no disponible");
  });
});
