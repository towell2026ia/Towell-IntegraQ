export type WorkspaceModuleId =
  | "home"
  | "processes"
  | "organization"
  | "access"
  | "documents"
  | "risks"
  | "indicators"
  | "audits"
  | "audit-app"
  | "corrective-actions"
  | "customers"
  | "customer-portal"
  | "suppliers"
  | "supplier-portal"
  | "management-review"
  | "forms"
  | "ai-assistant"
  | "integrations"
  | "data-traceability"
  | "calibrations";

export interface WorkspaceModuleMeta {
  label: string;
  breadcrumb: string;
  status: "Disponible" | "Estructura" | "Pendiente";
}

export const workspaceModuleMeta: Record<WorkspaceModuleId, WorkspaceModuleMeta> = {
  home: { label: "Inicio", breadcrumb: "Sistema de gestión", status: "Disponible" },
  processes: { label: "Procesos", breadcrumb: "Configuración", status: "Disponible" },
  organization: { label: "Organización y puestos", breadcrumb: "Configuración", status: "Disponible" },
  access: { label: "Usuarios y acceso", breadcrumb: "Configuración", status: "Disponible" },
  documents: { label: "Información documentada", breadcrumb: "Operación", status: "Disponible" },
  risks: { label: "Riesgos y oportunidades", breadcrumb: "Operación", status: "Estructura" },
  indicators: { label: "Objetivos e indicadores", breadcrumb: "Operación", status: "Disponible" },
  audits: { label: "Auditorías", breadcrumb: "Operación", status: "Estructura" },
  "audit-app": { label: "App de auditorías", breadcrumb: "Operación", status: "Pendiente" },
  "corrective-actions": { label: "Root2Cause, NC y CAPA", breadcrumb: "Operación", status: "Disponible" },
  customers: { label: "Gestión de calidad de clientes", breadcrumb: "Operación", status: "Disponible" },
  "customer-portal": { label: "Portal del cliente", breadcrumb: "Portales", status: "Disponible" },
  suppliers: { label: "Gestión de calidad de proveedores", breadcrumb: "Operación", status: "Disponible" },
  "supplier-portal": { label: "Portal de proveedores", breadcrumb: "Portales", status: "Disponible" },
  "management-review": { label: "Revisión por la Dirección", breadcrumb: "Dirección", status: "Estructura" },
  forms: { label: "Formularios y dashboards", breadcrumb: "Configuración", status: "Estructura" },
  "ai-assistant": { label: "IA asistente", breadcrumb: "Plataforma", status: "Pendiente" },
  integrations: { label: "Notificaciones e integraciones", breadcrumb: "Plataforma", status: "Estructura" },
  "data-traceability": { label: "Datos y trazabilidad", breadcrumb: "Plataforma", status: "Estructura" },
  calibrations: { label: "Calibración y verificación", breadcrumb: "Operación", status: "Disponible" },
};

export function isWorkspaceModuleId(value: string): value is WorkspaceModuleId {
  return value in workspaceModuleMeta;
}
