import { describe, expect, it } from "vitest";

import {
  ALL_INDICATOR_AREAS,
  applyIndicatorRuntimeAccess,
  canManageIndicatorCatalog,
  canEditIndicatorPeriod,
  canUpdateIndicatorResult,
  canViewIndicator,
  getAccessibleIndicators,
  getDefaultIndicatorArea,
  getIndicatorCaptureDenialMessage,
  getIndicatorCaptureDenialReason,
  matchesIndicatorArea,
} from "@/lib/indicator-access";
import { buildInitialIndicatorDefinitions } from "@/lib/indicator-data";
import type { ActiveSession } from "@/lib/session-data";

const qualityIndicator = buildInitialIndicatorDefinitions()[0];
const admin: ActiveSession = {
  userId: "ADM-001",
  name: "Administrador",
  shortName: "Administrador",
  initials: "AD",
  position: "Gerencia",
  department: "Calidad",
  company: "Towell",
  userType: "Administrador",
  assignedProcessIds: [],
};
const user: ActiveSession = {
  ...admin,
  userId: "USR-001",
  name: "Usuario",
  shortName: "Usuario",
  initials: "US",
  userType: "Usuario interno",
  assignedProcessIds: ["P-08"],
  assignedModuleIds: ["indicators"],
  documentAccess: [{
    processId: "P-08",
    role: "modifier",
    inheritedFromPositionId: "PU-07",
  }],
  moduleActionPermissions: [{ moduleId: "indicators", action: "update" }],
};

describe("indicator access policy", () => {
  it("reserves catalog changes for administrators", () => {
    expect(canManageIndicatorCatalog(admin)).toBe(true);
    expect(canManageIndicatorCatalog(user)).toBe(false);
  });

  it("lets normal users view and update only assigned indicators", () => {
    expect(canViewIndicator(user, qualityIndicator)).toBe(true);
    expect(canUpdateIndicatorResult(user, qualityIndicator)).toBe(true);
    expect(canViewIndicator(user, { processId: "P-13" })).toBe(false);
    expect(canUpdateIndicatorResult(user, { processId: "P-13" })).toBe(false);
  });

  it("allows an objective linked to several processes when one authorized process matches", () => {
    const sharedObjective = {
      ...qualityIndicator,
      processId: "P-13",
      processIds: ["P-13", "P-08"],
    };

    expect(canViewIndicator(user, sharedObjective)).toBe(true);
    expect(canUpdateIndicatorResult(user, sharedObjective)).toBe(true);
  });

  it("keeps a process viewer without indicators:update from capturing results", () => {
    const viewer: ActiveSession = {
      ...user,
      documentAccess: [{
        processId: "P-08",
        role: "viewer",
        inheritedFromPositionId: "PU-16",
      }],
      moduleActionPermissions: [],
    };
    expect(canViewIndicator(viewer, qualityIndicator)).toBe(true);
    expect(canUpdateIndicatorResult(viewer, qualityIndicator)).toBe(false);
  });

  it("regression Karen: a document viewer can capture when indicators:update is enabled", () => {
    const karen: ActiveSession = {
      ...user,
      name: "Karen",
      documentAccess: [{
        processId: "P-08",
        role: "viewer",
        inheritedFromPositionId: "PU-KAREN",
      }],
      moduleActionPermissions: [{ moduleId: "indicators", action: "update" }],
    };

    expect(canViewIndicator(karen, qualityIndicator)).toBe(true);
    expect(canUpdateIndicatorResult(karen, qualityIndicator)).toBe(true);
  });

  it("gives administrators the complete indicator scope by default", () => {
    const indicators = buildInitialIndicatorDefinitions();

    expect(getAccessibleIndicators(admin, indicators)).toHaveLength(indicators.length);
    expect(getDefaultIndicatorArea(admin)).toBe(ALL_INDICATOR_AREAS);
    expect(matchesIndicatorArea(admin, indicators[0], ALL_INDICATOR_AREAS)).toBe(true);
    expect(matchesIndicatorArea(admin, indicators.at(-1)!, ALL_INDICATOR_AREAS)).toBe(true);
  });

  it("lets administrators edit past, current and future indicator periods", () => {
    expect(canEditIndicatorPeriod(admin, qualityIndicator, 2025, "Q1", new Date("2026-09-10T12:00:00-06:00"))).toBe(true);
    expect(canEditIndicatorPeriod(admin, qualityIndicator, 2026, "Q3", new Date("2026-09-10T12:00:00-06:00"))).toBe(true);
    expect(canEditIndicatorPeriod(admin, qualityIndicator, 2030, "Q4", new Date("2026-09-10T12:00:00-06:00"))).toBe(true);
  });

  it("keeps the programmed capture window for standard users", () => {
    expect(canEditIndicatorPeriod(user, qualityIndicator, 2026, "Q3", new Date("2026-10-10T12:00:00-06:00"))).toBe(true);
    expect(canEditIndicatorPeriod(user, qualityIndicator, 2026, "Q3", new Date("2026-09-30T12:00:00-06:00"))).toBe(false);
    expect(canEditIndicatorPeriod(user, qualityIndicator, 2026, "Q3", new Date("2026-09-10T12:00:00-06:00"))).toBe(false);
    expect(canEditIndicatorPeriod(user, qualityIndicator, 2030, "Q4", new Date("2026-09-10T12:00:00-06:00"))).toBe(false);
  });

  it("keeps standard users inside their assigned area", () => {
    expect(getDefaultIndicatorArea(user)).toBe("Calidad");
    expect(matchesIndicatorArea(user, qualityIndicator, ALL_INDICATOR_AREAS)).toBe(false);
  });

  it.each([
    ["admin con ventana cerrada", admin, "2026-10-08T12:00:00-06:00", true, null],
    ["interno autorizado con permiso y ventana abierta", user, "2026-10-07T12:00:00-06:00", true, null],
    ["interno autorizado con ventana cerrada", user, "2026-10-08T12:00:00-06:00", false, "window"],
    ["interno autorizado sin permiso", { ...user, moduleActionPermissions: [] }, "2026-10-07T12:00:00-06:00", false, "permission"],
    ["interno sin proceso con permiso", { ...user, assignedProcessIds: ["P-13"] }, "2026-10-07T12:00:00-06:00", false, "process"],
    ["externo con datos de permiso artificiales", { ...user, userType: "Cliente" as const }, "2026-10-07T12:00:00-06:00", false, "process"],
  ])("aplica la matriz de captura: %s", (_case, session, date, allowed, reason) => {
    const indicator = {
      ...qualityIndicator,
      captureWindows: {
        "2026": {
          Q1: { opensAt: "2026-03-31T08:00:00-06:00", closesAt: "2026-03-31T18:00:00-06:00" },
          Q2: { opensAt: "2026-06-30T08:00:00-06:00", closesAt: "2026-06-30T18:00:00-06:00" },
          Q3: { opensAt: "2026-10-07T08:00:00-06:00", closesAt: "2026-10-07T18:00:00-06:00" },
          Q4: { opensAt: "2026-12-31T08:00:00-06:00", closesAt: "2026-12-31T18:00:00-06:00" },
        },
      },
    };

    expect(canEditIndicatorPeriod(session, indicator, 2026, "Q3", new Date(date))).toBe(allowed);
    expect(getIndicatorCaptureDenialReason(session, indicator, 2026, "Q3", new Date(date))).toBe(reason);
  });

  it("revalidates current process and capture permissions without recreating the session", () => {
    const revoked = applyIndicatorRuntimeAccess(user, {
      administrator: false,
      assignedProcessIds: ["P-13"],
      canUpdate: false,
      canView: true,
    });
    expect(revoked.assignedProcessIds).toEqual(["P-13"]);
    expect(canUpdateIndicatorResult(revoked, qualityIndicator)).toBe(false);

    const restored = applyIndicatorRuntimeAccess(revoked, {
      administrator: false,
      assignedProcessIds: ["P-08"],
      canUpdate: true,
      canView: true,
    });
    expect(canUpdateIndicatorResult(restored, qualityIndicator)).toBe(true);
  });

  it("uses clear denial messages", () => {
    expect(getIndicatorCaptureDenialMessage("permission")).toBe("No tienes permiso para capturar resultados de este indicador.");
    expect(getIndicatorCaptureDenialMessage("process")).toBe("Este indicador no pertenece a uno de tus procesos asignados.");
    expect(getIndicatorCaptureDenialMessage("window")).toBe("El periodo de captura está cerrado. Consulta la fecha de apertura y cierre.");
  });
});
