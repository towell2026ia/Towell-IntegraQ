import { BookOpen, ScrollText, Compass, Target, Network, Workflow, Users, Truck, ClipboardCheck, GitBranch, TrendingUp, MessageSquare, History, ListChecks, Paperclip, type LucideIcon } from "lucide-react";
import type { WorkspaceModuleId } from "./navigation";

export interface ReviewSection {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Access requires view permission on this module. */
  module: WorkspaceModuleId;
  view: string;
  availability: string;
}

export interface ReviewVisit {
  sectionId: string;
  year: number;
  destination: WorkspaceModuleId;
}

export const managementReviewGroups: { group: string; sections: ReviewSection[] }[] = [
  { group: "Liderazgo y contexto", sections: [
    { id: "manual", title: "Manual de Calidad", description: "Expediente M-SGC-01 y revisiones autorizadas.", icon: BookOpen, module: "documents", view: "current-manual", availability: "Disponible" },
    { id: "policy", title: "Política de Calidad", description: "Compromisos vigentes de la organización.", icon: ScrollText, module: "documents", view: "current-policy", availability: "Disponible" },
    { id: "risks", title: "Riesgos y oportunidades", description: "FODA y planificación estratégica.", icon: Compass, module: "risks", view: "swot", availability: "Disponible" },
    { id: "objectives", title: "Objetivos e indicadores", description: "Metas y desempeño por proceso.", icon: Target, module: "indicators", view: "dashboard", availability: "Disponible" },
  ] },
  { group: "Partes interesadas internas", sections: [
    { id: "organization", title: "Organización y puestos", description: "Estructura, organigrama y responsabilidades.", icon: Network, module: "organization", view: "chart", availability: "Disponible" },
    { id: "processes", title: "Procesos", description: "MetroMap, entradas y salidas.", icon: Workflow, module: "processes", view: "map", availability: "Disponible" },
  ] },
  { group: "Partes interesadas externas", sections: [
    { id: "customers", title: "Gestión de Calidad de Clientes", description: "Reclamaciones, retroalimentación y acciones correctivas.", icon: Users, module: "customers", view: "cases", availability: "Disponible" },
    { id: "suppliers", title: "Gestión de Calidad de Proveedores", description: "RNCP, efectividad, evaluaciones y auditorías.", icon: Truck, module: "suppliers", view: "directory", availability: "Disponible" },
  ] },
  { group: "Evaluación del desempeño", sections: [
    { id: "audits", title: "Auditorías", description: "Programa de auditoría y resultados.", icon: ClipboardCheck, module: "audits", view: "calendar", availability: "Disponible" },
    { id: "actions", title: "Acciones correctivas", description: "Análisis Root2Cause y seguimiento.", icon: GitBranch, module: "corrective-actions", view: "lists", availability: "Disponible" },
    { id: "improvement", title: "Mejora continua", description: "Proyectos y resultados documentados.", icon: TrendingUp, module: "continuous-improvement", view: "portfolio", availability: "Disponible" },
    { id: "satisfaction", title: "Satisfacción del cliente", description: "Resultados de satisfacción del cliente.", icon: MessageSquare, module: "customers", view: "satisfaccion", availability: "Pendiente de integración" },
  ] },
  { group: "Seguimiento de la revisión", sections: [
    { id: "history", title: "Revisiones anteriores", description: "Actas, informes y aprobaciones por período.", icon: History, module: "management-review", view: "history", availability: "Disponible" },
    { id: "outputs", title: "Salidas de Revisión por la Dirección", description: "Acuerdos y seguimiento de decisiones.", icon: ListChecks, module: "management-review", view: "acuerdos", availability: "Previsto para RE-04" },
    { id: "attachments", title: "Evidencias y adjuntos", description: "Documentación complementaria del período.", icon: Paperclip, module: "management-review", view: "attachments", availability: "Consulta disponible" },
  ] },
];
