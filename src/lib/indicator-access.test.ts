import { describe, expect, it } from "vitest";

import {
  ALL_INDICATOR_AREAS,
  canManageIndicatorCatalog,
  canUpdateIndicatorResult,
  canViewIndicator,
  getAccessibleIndicators,
  getDefaultIndicatorArea,
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

  it("keeps a process viewer from capturing indicator results", () => {
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

  it("gives administrators the complete indicator scope by default", () => {
    const indicators = buildInitialIndicatorDefinitions();

    expect(getAccessibleIndicators(admin, indicators)).toHaveLength(indicators.length);
    expect(getDefaultIndicatorArea(admin)).toBe(ALL_INDICATOR_AREAS);
    expect(matchesIndicatorArea(admin, indicators[0], ALL_INDICATOR_AREAS)).toBe(true);
    expect(matchesIndicatorArea(admin, indicators.at(-1)!, ALL_INDICATOR_AREAS)).toBe(true);
  });

  it("keeps standard users inside their assigned area", () => {
    expect(getDefaultIndicatorArea(user)).toBe("Calidad");
    expect(matchesIndicatorArea(user, qualityIndicator, ALL_INDICATOR_AREAS)).toBe(false);
  });
});
