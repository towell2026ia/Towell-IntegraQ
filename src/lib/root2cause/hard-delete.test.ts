import { describe, expect, it } from "vitest";
import { activeSession } from "@/lib/session-data";
import { canHardDeleteCorrectiveAction, validateHardDeleteConfirmation } from "./hard-delete";

describe("Root2Cause hard-delete authorization and confirmation", () => {
  it("requires administrator role and an explicit manage grant", () => {
    expect(canHardDeleteCorrectiveAction(activeSession)).toBe(false);
    expect(canHardDeleteCorrectiveAction({ ...activeSession, moduleActionPermissions: [{ moduleId: "corrective-actions", action: "manage", source: "direct" }] })).toBe(true);
    expect(canHardDeleteCorrectiveAction({ ...activeSession, moduleActionPermissions: [{ moduleId: "corrective-actions", action: "manage", source: "position" }] })).toBe(false);
    expect(canHardDeleteCorrectiveAction({ ...activeSession, userType: "Usuario interno", moduleActionPermissions: [{ moduleId: "corrective-actions", action: "manage", source: "direct" }] })).toBe(false);
  });

  it("requires a reason and exact AC code before the destructive request", () => {
    const base = { actionId: "0f11a122-c777-45ba-8d43-dbc1c135ff11", folio: "AC-2026-015", reason: "Duplicado confirmado", folioConfirmation: "AC-2026-015" };
    expect(validateHardDeleteConfirmation(base)).toBeNull();
    expect(validateHardDeleteConfirmation({ ...base, reason: "  " })).toMatch(/motivo/i);
    expect(validateHardDeleteConfirmation({ ...base, folioConfirmation: "AC-2026-15" })).toMatch(/exacto/i);
    expect(validateHardDeleteConfirmation({ ...base, reason: "x".repeat(1001) })).toMatch(/1,000/);
  });
});
