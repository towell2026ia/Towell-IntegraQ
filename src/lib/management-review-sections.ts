import { BookOpen, ScrollText, Compass, Target, Network, Workflow, Users, Truck, ClipboardCheck, GitBranch, TrendingUp, MessageSquare, History, ListChecks, Paperclip, type LucideIcon } from "lucide-react";
import type { WorkspaceModuleId } from "./navigation";

interface ReviewSection {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Access requires view permission on this module. */
  module: WorkspaceModuleId;
  view: string;
  availability: string;
}

export const managementReviewGroups = [
  { group: "Liderazgo y contexto", sections: [
    { id: "manual", title: "Manual de Calidad", description: "Documento vigente del sistema de gestión.", icon: BookOpen, module: "documents", view: "manual", availability: "Conexión en RE-02" },
    { id: "policy", title: "Política de Calidad", description: "Compromisos vigentes de la organización.", icon: ScrollText, module: "documents", view: "politica", availability: "Conexión en RE-02" },
    { id: "risks", title: "Riesgos y oportunidades", description: "FODA y planificación estratégica.", icon: Compass, module: "risks", view: "foda", availability: "Conexión en RE-02" },
    { id: "objectives", title: "Objetivos e indicadores", description: "Metas y desempeño por proceso.", icon: Target, module: "indicators", view: "objetivos", availability: "Conexión en RE-02" },
  ] },
  { group: "Partes interesadas internas", sections: [
    { id: "organization", title: "Organización y puestos", description: "Estructura, organigrama y responsabilidades.", icon: Network, module: "organization", view: "organigrama", availability: "Conexión en RE-02" },
    { id: "processes", title: "Procesos", description: "MetroMap, entradas y salidas.", icon: Workflow, module: "processes", view: "metromap", availability: "Conexión en RE-02" },
  ] },
  { group: "Partes interesadas externas", sections: [
    { id: "customers", title: "Gestión de Calidad de Clientes", description: "Reclamaciones, retroalimentación y acciones correctivas.", icon: Users, module: "customers", view: "reclamos", availability: "Conexión en RE-02" },
    { id: "suppliers", title: "Gestión de Calidad de Proveedores", description: "RNCP, efectividad, evaluaciones y auditorías.", icon: Truck, module: "suppliers", view: "directorio", availability: "Conexión en RE-02" },
  ] },
  { group: "Evaluación del desempeño", sections: [
    { id: "audits", title: "Auditorías", description: "Programa de auditoría y resultados.", icon: ClipboardCheck, module: "audits", view: "programa", availability: "Conexión en RE-02" },
    { id: "actions", title: "Acciones correctivas", description: "Análisis Root2Cause y seguimiento.", icon: GitBranch, module: "corrective-actions", view: "acciones", availability: "Conexión en RE-02" },
    { id: "improvement", title: "Mejora continua", description: "Proyectos y resultados documentados.", icon: TrendingUp, module: "continuous-improvement", view: "proyectos", availability: "Conexión en RE-02" },
    { id: "satisfaction", title: "Satisfacción del cliente", description: "Resultados de satisfacción del cliente.", icon: MessageSquare, module: "customers", view: "satisfaccion", availability: "Pendiente de integración" },
  ] },
  { group: "Seguimiento de la revisión", sections: [
    { id: "history", title: "Revisiones anteriores", description: "Actas, informes y aprobaciones por período.", icon: History, module: "management-review", view: "history", availability: "Disponible" },
    { id: "outputs", title: "Salidas de Revisión por la Dirección", description: "Acuerdos y seguimiento de decisiones.", icon: ListChecks, module: "management-review", view: "acuerdos", availability: "Previsto para RE-04" },
    { id: "attachments", title: "Evidencias y adjuntos", description: "Consulta de actas y archivos históricos.", icon: Paperclip, module: "management-review", view: "attachments", availability: "Consulta disponible" },
  ] },
] satisfies { group: string; sections: ReviewSection[] }[];
