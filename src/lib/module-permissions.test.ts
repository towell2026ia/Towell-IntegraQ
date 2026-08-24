import { describe, expect, it } from "vitest";

import {
  canPerformModuleAction,
  normalizeModulePermissions,
} from "@/lib/module-permissions";
import type { ActiveSession } from "@/lib/session-data";

const viewer: ActiveSession = {
  userId: "USR-VIEWER",
  name: "Supervisor",
  shortName: "Supervisor",
  initials: "SU",
  position: "Supervisor de Tejido",
  department: "Tejido",
  company: "Towell",
  userType: "Usuario interno",
  assignedProcessIds: ["P-13"],
  assignedModuleIds: ["indicators", "continuous-improvement"],
  moduleActionPermissions: [
    { moduleId: "indicators", action: "view" },
    { moduleId: "continuous-improvement", action: "create" },
  ],
};

describe("module action permissions", () => {
  it("separates viewing indicators from capturing results", () => {
    expect(canPerformModuleAction(viewer, "indicators", "view")).toBe(true);
    expect(canPerformModuleAction(viewer, "indicators", "update")).toBe(false);
  });

  it("allows initiative intake without portfolio follow-up", () => {
    expect(canPerformModuleAction(viewer, "continuous-improvement", "create")).toBe(true);
    expect(canPerformModuleAction(viewer, "continuous-improvement", "update")).toBe(false);
    expect(canPerformModuleAction(viewer, "continuous-improvement", "manage")).toBe(false);
  });

  it("adds view whenever a mutating action is assigned", () => {
    expect(normalizeModulePermissions([
      { moduleId: "calibrations", action: "update" },
    ])).toEqual(expect.arrayContaining([
      { moduleId: "calibrations", action: "view" },
      { moduleId: "calibrations", action: "update" },
    ]));
  });

  it("keeps administrators unrestricted", () => {
    expect(canPerformModuleAction({
      ...viewer,
      userType: "Administrador",
      assignedModuleIds: [],
      moduleActionPermissions: [],
    }, "calibrations", "manage")).toBe(true);
  });
});
