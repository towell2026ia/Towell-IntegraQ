import type { AiCapabilityDefinition } from "../registry";
import type { AiApprovalRequirement } from "./types";

export function getApprovalRequirement(capability: AiCapabilityDefinition): AiApprovalRequirement {
  return capability.requiresApproval
    ? { required: true, requiredPermission: "ai.approve", approverRole: "Autorizador del módulo", reason: "La capacidad genera un borrador o resultado que requiere validación humana." }
    : { required: false };
}

