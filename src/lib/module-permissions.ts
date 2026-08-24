import type { WorkspaceModuleId } from "@/lib/navigation";
import type {
  ActiveSession,
  ModuleActionPermission,
  ModulePermissionAction,
} from "@/lib/session-data";
import { isAdministrator } from "@/lib/session-data";

export interface ModuleCapability {
  action: ModulePermissionAction;
  label: string;
  description: string;
}

export interface ModulePermissionGroup {
  moduleId: WorkspaceModuleId;
  label: string;
  capabilities: ModuleCapability[];
}

export const editableModulePermissionGroups: ModulePermissionGroup[] = [
  {
    moduleId: "documents",
    label: "Información documentada",
    capabilities: [
      { action: "view", label: "Consultar", description: "Ve documentos de sus procesos." },
      { action: "update", label: "Modificar", description: "Carga revisiones y envía a validación." },
      { action: "approve", label: "Autorizar", description: "Aprueba o rechaza documentos asignados." },
    ],
  },
  {
    moduleId: "indicators",
    label: "Objetivos e indicadores",
    capabilities: [
      { action: "view", label: "Consultar", description: "Ve tablero, sábana y pendientes de sus procesos." },
      { action: "update", label: "Capturar resultados", description: "Registra resultado, comentarios y evidencia en la ventana programada." },
    ],
  },
  {
    moduleId: "continuous-improvement",
    label: "Mejora continua",
    capabilities: [
      { action: "view", label: "Consultar", description: "Ve iniciativas propias o proyectos donde participa." },
      { action: "create", label: "Cargar iniciativa", description: "Registra una idea o un proyecto para sus procesos." },
      { action: "update", label: "Dar seguimiento", description: "Actualiza fases, herramientas, acciones y evidencias asignadas." },
      { action: "manage", label: "Gestionar portafolio", description: "Clasifica, pondera, autoriza fases y cierra proyectos." },
    ],
  },
  {
    moduleId: "calibrations",
    label: "Calibración y verificación",
    capabilities: [
      { action: "view", label: "Consultar vigencia", description: "Ve si los equipos están verificados o calibrados." },
      { action: "update", label: "Registrar ejecución", description: "Captura verificaciones, calibraciones y evidencia." },
      { action: "manage", label: "Administrar equipos", description: "Da de alta equipos, patrones y programas." },
    ],
  },
  {
    moduleId: "corrective-actions",
    label: "Root2Cause, NC y CAPA",
    capabilities: [
      { action: "view", label: "Consultar asignadas", description: "Ve únicamente acciones y análisis donde participa." },
      { action: "create", label: "Abrir acción", description: "Inicia una nueva acción correctiva." },
      { action: "update", label: "Trabajar análisis", description: "Actualiza A3, planes y evidencias donde participa." },
    ],
  },
  {
    moduleId: "risks",
    label: "Riesgos y oportunidades",
    capabilities: [
      { action: "view", label: "Consultar", description: "Ve riesgos de sus procesos." },
      { action: "update", label: "Modificar", description: "Registra y actualiza riesgos de procesos modificables." },
    ],
  },
  {
    moduleId: "forms",
    label: "Formularios y dashboards",
    capabilities: [
      { action: "view", label: "Consultar", description: "Ve formularios, registros y dashboards autorizados." },
      { action: "create", label: "Capturar", description: "Llena formularios de sus procesos." },
      { action: "update", label: "Diseñar", description: "Modifica estructura y configuración del formulario." },
      { action: "manage", label: "Configurar dashboard", description: "Diseña y publica el dashboard inteligente." },
    ],
  },
  {
    moduleId: "audits",
    label: "Auditorías",
    capabilities: [
      { action: "view", label: "Consultar", description: "Ve auditorías donde participa o de sus procesos." },
      { action: "update", label: "Participar", description: "Captura checklist, hallazgos y evidencia asignada." },
      { action: "manage", label: "Administrar programa", description: "Programa auditorías y administra resultados." },
    ],
  },
];

export function hasModuleAction(
  permissions: ModuleActionPermission[],
  moduleId: WorkspaceModuleId,
  action: ModulePermissionAction,
) {
  return permissions.some(
    (permission) =>
      permission.moduleId === moduleId && permission.action === action,
  );
}

export function canPerformModuleAction(
  session: ActiveSession,
  moduleId: WorkspaceModuleId,
  action: ModulePermissionAction,
) {
  if (isAdministrator(session)) return true;
  if (action === "view" && session.assignedModuleIds?.includes(moduleId)) {
    return true;
  }
  return hasModuleAction(
    session.moduleActionPermissions ?? [],
    moduleId,
    action,
  );
}

export function normalizeModulePermissions(
  permissions: ModuleActionPermission[],
) {
  const normalized = new Map<string, ModuleActionPermission>();
  for (const permission of permissions) {
    normalized.set(
      `${permission.moduleId}:${permission.action}`,
      permission,
    );
    if (permission.action !== "view") {
      normalized.set(`${permission.moduleId}:view`, {
        moduleId: permission.moduleId,
        action: "view",
      });
    }
  }
  return [...normalized.values()];
}
