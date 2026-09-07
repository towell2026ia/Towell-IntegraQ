import type { ModulePermissionAction } from "@/lib/session-data";

import type { PermissionRiskLevel } from "./types";

export interface PermissionDefinition {
  code: string;
  module: string;
  action: string;
  riskLevel: PermissionRiskLevel;
  description: string;
}

const definitions: Array<[string, PermissionRiskLevel, string]> = [
  ["system.admin", "CRITICAL", "Administrar la plataforma"],
  ["system.activity.read", "HIGH", "Consultar la bitácora transversal"],
  ["system.activity.export", "HIGH", "Exportar la bitácora transversal"],
  ["system.organization.administer", "CRITICAL", "Administrar organización y puestos"],
  ["organization.position.create", "MEDIUM", "Crear puestos dentro del alcance"],
  ["documents.file.read", "LOW", "Consultar documentos"],
  ["documents.file.create", "MEDIUM", "Crear documentos"],
  ["documents.file.edit", "MEDIUM", "Editar documentos"],
  ["documents.file.submit", "MEDIUM", "Enviar documentos a validación"],
  ["documents.file.validate", "HIGH", "Validar documentos"],
  ["documents.file.approve", "HIGH", "Aprobar documentos"],
  ["documents.file.reject", "HIGH", "Rechazar documentos"],
  ["documents.file.publish", "HIGH", "Publicar documentos"],
  ["risks.read", "LOW", "Consultar riesgos"],
  ["risks.create", "MEDIUM", "Crear riesgos"],
  ["risks.edit", "MEDIUM", "Editar riesgos"],
  ["risks.evaluate", "MEDIUM", "Evaluar riesgos"],
  ["risks.approve", "HIGH", "Aprobar riesgos"],
  ["risks.close", "HIGH", "Cerrar riesgos"],
  ["audits.program.create", "MEDIUM", "Crear programas de auditoría"],
  ["audits.program.approve", "HIGH", "Aprobar programas de auditoría"],
  ["audits.plan.create", "MEDIUM", "Crear planes de auditoría"],
  ["audits.plan.approve", "HIGH", "Aprobar planes de auditoría"],
  ["audits.auditor.assign", "HIGH", "Asignar auditores"],
  ["audits.execute", "MEDIUM", "Ejecutar auditorías asignadas"],
  ["audits.finding.create", "MEDIUM", "Crear hallazgos"],
  ["audits.finding.validate", "HIGH", "Validar hallazgos"],
  ["audits.report.generate", "MEDIUM", "Generar informes de auditoría"],
  ["audits.report.approve", "HIGH", "Aprobar informes de auditoría"],
  ["audits.close", "HIGH", "Cerrar auditorías"],
  ["corrective_actions.create", "MEDIUM", "Crear acciones correctivas"],
  ["corrective_actions.analyze", "MEDIUM", "Realizar análisis de causa"],
  ["corrective_actions.action.assign", "MEDIUM", "Asignar acciones"],
  ["corrective_actions.evidence.submit", "MEDIUM", "Presentar evidencias"],
  ["corrective_actions.effectiveness.validate", "HIGH", "Validar eficacia"],
  ["corrective_actions.close", "HIGH", "Cerrar acciones correctivas"],
  ["metrology.equipment.read", "LOW", "Consultar equipos"],
  ["metrology.equipment.edit", "MEDIUM", "Editar equipos"],
  ["metrology.verification.execute", "MEDIUM", "Ejecutar verificaciones"],
  ["metrology.calibration.record", "MEDIUM", "Registrar calibraciones"],
  ["metrology.report.create", "MEDIUM", "Crear informes metrológicos"],
  ["metrology.report.validate", "HIGH", "Validar informes metrológicos"],
  ["metrology.equipment.status.change", "HIGH", "Cambiar estado de equipos"],
  ["improvement.create", "MEDIUM", "Crear mejoras"],
  ["improvement.edit", "MEDIUM", "Editar mejoras"],
  ["improvement.prioritize", "HIGH", "Priorizar mejoras"],
  ["improvement.approve", "HIGH", "Aprobar mejoras"],
  ["improvement.close", "HIGH", "Cerrar mejoras"],
  ["management_review.read", "HIGH", "Consultar revisión por la Dirección"],
  ["management_review.prepare", "HIGH", "Preparar revisión por la Dirección"],
  ["management_review.edit", "HIGH", "Editar revisión por la Dirección"],
  ["management_review.submit", "HIGH", "Enviar revisión por la Dirección"],
  ["management_review.approve", "CRITICAL", "Aprobar revisión por la Dirección"],
  ["management_review.publish", "CRITICAL", "Publicar revisión por la Dirección"],
  ["ai.read", "LOW", "Consultar funciones de IA futuras"],
  ["ai.suggest", "LOW", "Solicitar sugerencias de IA futuras"],
  ["ai.generate_draft", "MEDIUM", "Generar borradores con IA futura"],
  ["ai.execute", "HIGH", "Ejecutar acciones asistidas futuras"],
  ["ai.approve", "CRITICAL", "Aprobar acciones de IA futuras"],
];

export const permissionCatalog: PermissionDefinition[] = definitions.map(([code, riskLevel, description]) => {
  const parts = code.split(".");
  return { code, module: parts[0], action: parts.at(-1) ?? "read", riskLevel, description };
});

export const permissionCodes = new Set(permissionCatalog.map((permission) => permission.code));

export function legacyPermissionCode(moduleId: string, action: ModulePermissionAction) {
  const actions: Record<ModulePermissionAction, string> = { view: "read", create: "create", update: "edit", submit: "submit", review: "validate", approve: "approve", close: "close", reopen: "reopen", export: "export", manage: "administer" };
  const modules: Record<string, string> = { calibrations: "metrology", "continuous-improvement": "improvement", "management-review": "management_review", "corrective-actions": "corrective_actions" };
  const permissionModule = modules[moduleId] ?? moduleId;
  const candidate = `${permissionModule}.${actions[action]}`;
  if (permissionCodes.has(candidate)) return candidate;
  const resourceCandidates = permissionCatalog.filter((item) => item.module === permissionModule && item.action === actions[action]);
  return resourceCandidates[0]?.code ?? candidate;
}
