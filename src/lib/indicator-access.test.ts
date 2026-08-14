import { describe, expect, it } from "vitest";

import {
  canManageIndicatorCatalog,
  canUpdateIndicatorResult,
  canViewIndicator,
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
  userType: "Usuario",
  assignedProcessIds: ["P-08"],
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
});
