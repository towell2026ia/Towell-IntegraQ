export type DocumentType = {
  id: string;
  code: string;
  name: string;
  description: string;
};

export const documentTypeCatalog: DocumentType[] = [
  {
    id: "processes",
    code: "PRO",
    name: "Procesos",
    description: "Caracterizaciones, mapas y fichas de proceso.",
  },
  {
    id: "manuals",
    code: "MAN",
    name: "Manuales",
    description: "Lineamientos generales y manuales del sistema.",
  },
  {
    id: "procedures",
    code: "PRC",
    name: "Procedimientos",
    description: "Métodos y responsabilidades para ejecutar actividades.",
  },
  {
    id: "instructions",
    code: "INS",
    name: "Instructivos",
    description: "Indicaciones detalladas para tareas específicas.",
  },
  {
    id: "forms",
    code: "FOR",
    name: "Formatos",
    description: "Plantillas y archivos controlados para conservar evidencia.",
  },
  {
    id: "application-forms",
    code: "FML",
    name: "Formularios",
    description: "Capturas digitales con dashboard y registros consultables.",
  },
  {
    id: "standard-operation-sheets",
    code: "HOE",
    name: "Hojas de Operación Estándar",
    description: "Secuencias y parámetros estándar de operación.",
  },
  {
    id: "visual-aids",
    code: "AV",
    name: "Ayudas visuales",
    description: "Referencias gráficas disponibles en el punto de uso.",
  },
];

export interface DocumentProcessGroup {
  processId: string;
  memberProcessIds: string[];
}

export const databaseDocumentTypeIds: Record<string, string> = {
  processes: "process",
  manuals: "manual",
  procedures: "procedure",
  instructions: "instruction",
  forms: "format",
  "application-forms": "form",
  "standard-operation-sheets": "standard-operation-sheet",
  "visual-aids": "visual-aid",
};

export const clientDocumentTypeIds = Object.fromEntries(
  Object.entries(databaseDocumentTypeIds).map(([clientId, databaseId]) => [
    databaseId,
    clientId,
  ]),
) as Record<string, string>;

export const documentValidatorByProcess: Record<
  string,
  { name: string; positionId: string }
> = {
  "P-01": { name: "Gerencia de Cuentas Clave", positionId: "PU-11" },
  "P-02": { name: "Jefatura de Diseño", positionId: "PU-13" },
  "P-03": { name: "Dirección General", positionId: "PU-01" },
  "P-04": { name: "Jefatura de Planeación", positionId: "PU-26" },
  "P-05": { name: "Jefatura de Seguridad, Higiene y Medio Ambiente", positionId: "PU-15" },
  "P-06": { name: "Gerencia de Contabilidad", positionId: "PU-20" },
  "P-07": { name: "Gerencia de Tecnologías de Información", positionId: "PU-09" },
  "P-08": { name: "Gerencia de Aseguramiento de Calidad", positionId: "PU-07" },
  "P-09": { name: "Jefatura de Almacén", positionId: "PU-27" },
  "P-10": { name: "Jefatura de Compras", positionId: "PU-18" },
  "P-11": { name: "Gerencia de Recursos Humanos", positionId: "PU-10" },
  "P-12": { name: "Jefatura de Mantenimiento", positionId: "PU-25" },
  "P-13": { name: "Jefatura de Tejido", positionId: "PU-12" },
  "P-17": { name: "Jefatura de Teñido", positionId: "PU-14" },
  "P-22": { name: "Gerencia de Manufactura", positionId: "PU-06" },
  "P-31": { name: "Gerencia de Logística y Distribución", positionId: "PU-08" },
  "P-34": { name: "Gerencia de Logística y Distribución", positionId: "PU-08" },
  "P-35": { name: "Gerencia de Aseguramiento de Calidad", positionId: "PU-07" },
};

/**
 * Agrupaciones exclusivas del expediente documental.
 *
 * No sustituyen la jerarquía operativa del catálogo de procesos. Un proceso
 * puede pertenecer a más de un expediente documental; P-19 es el caso
 * confirmado para Tejido y Tintorería.
 */
export const documentProcessGroups: DocumentProcessGroup[] = [
  { processId: "P-13", memberProcessIds: ["P-14", "P-15", "P-16", "P-19"] },
  { processId: "P-17", memberProcessIds: ["P-18", "P-19", "P-20", "P-21"] },
  { processId: "P-22", memberProcessIds: ["P-23", "P-24", "P-25", "P-26", "P-27"] },
  { processId: "P-34", memberProcessIds: ["P-28", "P-29", "P-30", "P-32", "P-33"] },
];

const groupedDocumentProcessIds = new Set(
  documentProcessGroups.flatMap((group) => group.memberProcessIds),
);

export function isGroupedDocumentProcess(processId: string) {
  return groupedDocumentProcessIds.has(processId);
}

export function getDocumentProcessIds(processId: string) {
  const group = documentProcessGroups.find((item) => item.processId === processId);
  return group ? [group.processId, ...group.memberProcessIds] : [processId];
}

export function getPrimaryDocumentProcessId(processId: string) {
  return (
    documentProcessGroups.find((group) =>
      group.memberProcessIds.includes(processId),
    )?.processId ?? processId
  );
}
