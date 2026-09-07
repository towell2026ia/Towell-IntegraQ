import type { AiCapabilityDefinition } from "./types";

export class AiCapabilityRegistry {
  private readonly capabilities = new Map<string, AiCapabilityDefinition>();

  constructor(capabilities: AiCapabilityDefinition[] = []) {
    capabilities.forEach((capability) => this.register(capability));
  }

  register(capability: AiCapabilityDefinition) {
    if (this.capabilities.has(capability.id)) throw new Error(`La capacidad ${capability.id} ya está registrada.`);
    this.capabilities.set(capability.id, Object.freeze({ ...capability, requiredPermissions: [...capability.requiredPermissions] }));
    return this;
  }

  get(id: string) {
    return this.capabilities.get(id);
  }

  list() {
    return [...this.capabilities.values()];
  }

  isEnabled(id: string) {
    return this.get(id)?.status === "enabled";
  }
}

export const aiCapabilityRegistry = new AiCapabilityRegistry([
  { id: "risks.evaluate", name: "Evaluar riesgos", module: "risks", status: "disabled", requiredPermissions: ["ai.suggest"], requiresApproval: false },
  { id: "rootcause.analyze", name: "Analizar causa raíz", module: "corrective-actions", status: "disabled", requiredPermissions: ["ai.generate_draft"], requiresApproval: true },
  { id: "audits.plan", name: "Planear auditoría", module: "audits", status: "disabled", requiredPermissions: ["ai.generate_draft"], requiresApproval: true },
  { id: "metrology.guide", name: "Orientar metrología", module: "calibrations", status: "disabled", requiredPermissions: ["ai.suggest"], requiresApproval: false },
  { id: "improvements.suggest", name: "Sugerir mejora", module: "continuous-improvement", status: "disabled", requiredPermissions: ["ai.suggest"], requiresApproval: false },
  { id: "management.generate_review", name: "Generar revisión por la Dirección", module: "management-review", status: "disabled", requiredPermissions: ["ai.generate_draft"], requiresApproval: true },
]);

