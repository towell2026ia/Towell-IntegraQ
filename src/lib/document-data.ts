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
