import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "./session-data";
import { canReturnFromReview } from "../components/modules/review-return-button";
import { sessionAccessKey } from "./workspace-continuity";
import { managementReviewGroups } from "./management-review-sections";
import { verifyReviewNavigation } from "./verify-review-navigation";
import { getAuthenticatedSession } from "./supabase/auth-session";

vi.mock("./supabase/auth-session", () => ({ getAuthenticatedSession: vi.fn() }));
const admin: ActiveSession = { ...activeSession, authUserId: "administrator", organizationId: "org" };
beforeEach(() => vi.mocked(getAuthenticatedSession).mockResolvedValue(admin));

describe("retorno a Revisión por la Dirección", () => {
  it.each(["Administrador", "Usuario interno", "Cliente", "Proveedor"] as const)("valida rol y origen para %s", userType => {
    const session = { ...admin, userType, assignedModuleIds: ["customers", "management-review"] as ActiveSession["assignedModuleIds"] };
    expect(canReturnFromReview(session, true, "customers")).toBe(userType === "Administrador");
    expect(canReturnFromReview(session, false, "customers")).toBe(false);
  });
  it("requiere una identidad autenticada y organización", () => {
    expect(canReturnFromReview({ ...admin, authUserId: undefined }, true, "risks")).toBe(false);
    expect(canReturnFromReview({ ...admin, organizationId: undefined }, true, "risks")).toBe(false);
  });
  it("rechaza cambio de identidad, alcance, rol o cierre de sesión", async () => {
    const scope = sessionAccessKey(admin);
    expect(await verifyReviewNavigation("corrective-actions", scope)).toBe(true);
    for (const session of [null, { ...admin, authUserId: "another" }, { ...admin, organizationId: "other" },
      { ...admin, assignedProcessIds: [] }, { ...admin, userType: "Usuario interno" as const }]) {
      vi.mocked(getAuthenticatedSession).mockResolvedValue(session);
      expect(await verifyReviewNavigation("corrective-actions", scope)).toBe(false);
    }
  });
  it("mantiene el acceso del interno autorizado sin ofrecerle retorno administrativo", async () => {
    const session: ActiveSession = { ...admin, userType: "Usuario interno", assignedModuleIds: ["management-review", "processes"] };
    vi.mocked(getAuthenticatedSession).mockResolvedValue(session);
    expect(await verifyReviewNavigation("processes", sessionAccessKey(session))).toBe(true);
    expect(await verifyReviewNavigation("risks", sessionAccessKey(session))).toBe(false);
    expect(canReturnFromReview(session, true, "processes")).toBe(false);
  });
  it.each(["Cliente", "Proveedor"] as const)("rechaza navegación ejecutiva del usuario externo %s", async userType => {
    const session: ActiveSession = { ...admin, userType, assignedModuleIds: ["management-review", "customers"] };
    vi.mocked(getAuthenticatedSession).mockResolvedValue(session);
    expect(await verifyReviewNavigation("customers", sessionAccessKey(session))).toBe(false);
  });
  it("mantiene los quince apartados y los destinos reales", () => {
    const sections = managementReviewGroups.flatMap(group => group.sections);
    expect(sections).toHaveLength(15);
    expect(Object.fromEntries(sections.filter(section => section.availability === "Disponible").map(s => [s.id, s.view]))).toEqual({
      manual: "current-manual", policy: "current-policy", risks: "swot", objectives: "dashboard", organization: "chart", processes: "map",
      customers: "cases", suppliers: "directory", audits: "calendar", actions: "lists", improvement: "portfolio", history: "history", outputs: "acuerdos",
    });
  });
});
