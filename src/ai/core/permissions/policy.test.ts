import { describe, expect, it } from "vitest";

import type { ActiveSession } from "@/lib/session-data";

import { canUseAiCapability } from ".";

const internalUser: ActiveSession = {
  userId: "U-1", name: "Usuario", shortName: "Usuario", initials: "U", position: "auditor", department: "calidad", company: "Towell", userType: "Usuario interno",
  assignedProcessIds: ["P-08"], assignedModuleIds: ["risks"], moduleActionPermissions: [{ moduleId: "risks", action: "view" }],
};

describe("AI permissions", () => {
  it("allows a suggestion when current module access permits it", () => {
    expect(canUseAiCapability({ user: internalUser, module: "risks", requiredPermissions: ["ai.suggest"], record: { processId: "P-08" } }).allowed).toBe(true);
  });

  it("denies execution and records outside the assigned process", () => {
    expect(canUseAiCapability({ user: internalUser, module: "risks", requiredPermissions: ["ai.execute"] }).allowed).toBe(false);
    expect(canUseAiCapability({ user: internalUser, module: "risks", requiredPermissions: ["ai.read"], record: { processId: "P-13" } }).allowed).toBe(false);
  });
});

