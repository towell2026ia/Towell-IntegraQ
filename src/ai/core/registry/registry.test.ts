import { describe, expect, it } from "vitest";

import { AiCapabilityRegistry, aiCapabilityRegistry } from ".";

describe("AI capability registry", () => {
  it("finds known capabilities and keeps future ones disabled", () => {
    expect(aiCapabilityRegistry.get("risks.evaluate")?.name).toBe("Evaluar riesgos");
    expect(aiCapabilityRegistry.isEnabled("risks.evaluate")).toBe(false);
  });

  it("returns undefined for unknown capabilities", () => {
    expect(aiCapabilityRegistry.get("unknown.capability")).toBeUndefined();
  });

  it("prevents duplicate registrations", () => {
    const registry = new AiCapabilityRegistry([{ id: "test.read", name: "Test", module: "home", status: "disabled", requiredPermissions: ["ai.read"], requiresApproval: false }]);
    expect(() => registry.register({ id: "test.read", name: "Duplicate", module: "home", status: "disabled", requiredPermissions: ["ai.read"], requiresApproval: false })).toThrow();
  });
});

