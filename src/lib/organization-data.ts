export type ProcessRelationship = "owner" | "approver" | "participant" | "support";

export type ProcessLink = {
  processId: string;
  relationship: ProcessRelationship;
};

export type OrganizationPosition = {
  id: string;
  name: string;
  level: 1 | 2 | 3 | 4;
  parentId?: string;
  branch: string;
  processLinks: ProcessLink[];
};

export const processRelationshipLabels: Record<ProcessRelationship, string> = {
  owner: "Responsable",
  approver: "Aprobador",
  participant: "Participante",
  support: "Soporte",
};

export const organizationPositions: OrganizationPosition[] = [
  {
    id: "PU-01",
    name: "Dirección General",
    level: 1,
    branch: "Dirección",
    processLinks: [
      { processId: "P-03", relationship: "owner" },
      { processId: "P-04", relationship: "approver" },
      { processId: "P-08", relationship: "approver" },
    ],
  },
  {
    id: "PU-02",
    name: "Dirección de Operaciones",
    level: 2,
    parentId: "PU-01",
    branch: "Operaciones",
    processLinks: [
      { processId: "P-02", relationship: "approver" },
      { processId: "P-04", relationship: "approver" },
      { processId: "P-05", relationship: "approver" },
      { processId: "P-09", relationship: "approver" },
      { processId: "P-12", relationship: "approver" },
      { processId: "P-13", relationship: "approver" },
      { processId: "P-17", relationship: "approver" },
      { processId: "P-18", relationship: "approver" },
      { processId: "P-22", relationship: "approver" },
      { processId: "P-23", relationship: "approver" },
      { processId: "P-24", relationship: "approver" },
      { processId: "P-31", relationship: "approver" },
      { processId: "P-34", relationship: "approver" },
    ],
  },
  {
    id: "PU-03",
    name: "Dirección Administrativa",
    level: 2,
    parentId: "PU-01",
    branch: "Administración",
    processLinks: [
      { processId: "P-06", relationship: "approver" },
      { processId: "P-07", relationship: "approver" },
      { processId: "P-10", relationship: "approver" },
      { processId: "P-11", relationship: "approver" },
    ],
  },
  {
    id: "PU-04",
    name: "Dirección de Finanzas",
    level: 2,
    parentId: "PU-01",
    branch: "Finanzas",
    processLinks: [
      { processId: "P-06", relationship: "approver" },
      { processId: "P-01", relationship: "support" },
    ],
  },
  {
    id: "PU-05",
    name: "Dirección de Ventas",
    level: 2,
    parentId: "PU-01",
    branch: "Ventas",
    processLinks: [
      { processId: "P-01", relationship: "approver" },
      { processId: "P-33", relationship: "approver" },
    ],
  },
  {
    id: "PU-06",
    name: "Gerencia de Costura",
    level: 3,
    parentId: "PU-02",
    branch: "Operaciones",
    processLinks: [
      { processId: "P-22", relationship: "owner" },
      { processId: "P-23", relationship: "owner" },
      { processId: "P-24", relationship: "owner" },
      { processId: "P-25", relationship: "owner" },
      { processId: "P-26", relationship: "owner" },
      { processId: "P-27", relationship: "owner" },
      { processId: "P-29", relationship: "owner" },
    ],
  },
  {
    id: "PU-07",
    name: "Gerente de Aseguramiento de Calidad",
    level: 3,
    parentId: "PU-01",
    branch: "Calidad",
    processLinks: [
      { processId: "P-08", relationship: "owner" },
      { processId: "P-33", relationship: "support" },
    ],
  },
  {
    id: "PU-08",
    name: "Gerencia de Logística y Distribución",
    level: 3,
    parentId: "PU-01",
    branch: "Logística",
    processLinks: [
      { processId: "P-31", relationship: "owner" },
      { processId: "P-34", relationship: "owner" },
      { processId: "P-28", relationship: "owner" },
      { processId: "P-30", relationship: "owner" },
      { processId: "P-32", relationship: "owner" },
      { processId: "P-09", relationship: "support" },
    ],
  },
  {
    id: "PU-09",
    name: "Gerencia de Tecnologías de Información",
    level: 3,
    parentId: "PU-03",
    branch: "Administración",
    processLinks: [{ processId: "P-07", relationship: "owner" }],
  },
  {
    id: "PU-10",
    name: "Gerencia de Recursos Humanos",
    level: 3,
    parentId: "PU-04",
    branch: "Finanzas",
    processLinks: [],
  },
  {
    id: "PU-11",
    name: "Gerencia de Cuentas Clave",
    level: 3,
    parentId: "PU-05",
    branch: "Ventas",
    processLinks: [
      { processId: "P-01", relationship: "owner" },
      { processId: "P-33", relationship: "owner" },
    ],
  },
  {
    id: "PU-12",
    name: "Jefe de Tejido",
    level: 4,
    parentId: "PU-02",
    branch: "Operaciones",
    processLinks: [
      { processId: "P-13", relationship: "owner" },
      { processId: "P-14", relationship: "owner" },
      { processId: "P-15", relationship: "owner" },
      { processId: "P-16", relationship: "owner" },
      { processId: "P-19", relationship: "owner" },
    ],
  },
  {
    id: "PU-13",
    name: "Jefe de Diseño",
    level: 4,
    parentId: "PU-02",
    branch: "Operaciones",
    processLinks: [{ processId: "P-02", relationship: "owner" }],
  },
  {
    id: "PU-14",
    name: "Jefe de Teñido",
    level: 4,
    parentId: "PU-02",
    branch: "Operaciones",
    processLinks: [
      { processId: "P-17", relationship: "owner" },
      { processId: "P-20", relationship: "owner" },
      { processId: "P-21", relationship: "owner" },
    ],
  },
  {
    id: "PU-15",
    name: "Jefe de S.H. y M.A.",
    level: 4,
    parentId: "PU-02",
    branch: "Operaciones",
    processLinks: [{ processId: "P-05", relationship: "owner" }],
  },
  {
    id: "PU-16",
    name: "Aseguramiento de Calidad",
    level: 4,
    parentId: "PU-07",
    branch: "Calidad",
    processLinks: [
      { processId: "P-08", relationship: "participant" },
      { processId: "P-13", relationship: "support" },
      { processId: "P-17", relationship: "support" },
      { processId: "P-22", relationship: "support" },
      { processId: "P-33", relationship: "support" },
    ],
  },
  {
    id: "PU-17",
    name: "Logística y Distribución",
    level: 4,
    parentId: "PU-08",
    branch: "Logística",
    processLinks: [
      { processId: "P-31", relationship: "participant" },
      { processId: "P-32", relationship: "owner" },
      { processId: "P-34", relationship: "participant" },
    ],
  },
  {
    id: "PU-18",
    name: "Jefe de Compras",
    level: 4,
    parentId: "PU-03",
    branch: "Administración",
    processLinks: [{ processId: "P-10", relationship: "owner" }],
  },
  {
    id: "PU-19",
    name: "Jefe de Costos",
    level: 4,
    parentId: "PU-03",
    branch: "Administración",
    processLinks: [
      { processId: "P-06", relationship: "participant" },
      { processId: "P-13", relationship: "support" },
      { processId: "P-17", relationship: "support" },
      { processId: "P-22", relationship: "support" },
    ],
  },
  {
    id: "PU-20",
    name: "Jefe de Contabilidad",
    level: 4,
    parentId: "PU-03",
    branch: "Administración",
    processLinks: [{ processId: "P-06", relationship: "owner" }],
  },
  {
    id: "PU-21",
    name: "Jefe de Facturación",
    level: 4,
    parentId: "PU-03",
    branch: "Administración",
    processLinks: [
      { processId: "P-06", relationship: "participant" },
      { processId: "P-01", relationship: "support" },
      { processId: "P-32", relationship: "support" },
    ],
  },
  {
    id: "PU-22",
    name: "Coordinador de Tesorería",
    level: 4,
    parentId: "PU-04",
    branch: "Finanzas",
    processLinks: [{ processId: "P-06", relationship: "participant" }],
  },
  {
    id: "PU-23",
    name: "Coordinador de Cobranza",
    level: 4,
    parentId: "PU-04",
    branch: "Finanzas",
    processLinks: [
      { processId: "P-06", relationship: "participant" },
      { processId: "P-01", relationship: "support" },
    ],
  },
  {
    id: "PU-24",
    name: "Ejecutivos de Ventas",
    level: 4,
    parentId: "PU-11",
    branch: "Ventas",
    processLinks: [
      { processId: "P-01", relationship: "participant" },
      { processId: "P-33", relationship: "participant" },
    ],
  },
  {
    id: "PU-25",
    name: "Jefe de Mantenimiento",
    level: 4,
    parentId: "PU-02",
    branch: "Operaciones",
    processLinks: [{ processId: "P-12", relationship: "owner" }],
  },
  {
    id: "PU-26",
    name: "Jefe de Planeación",
    level: 4,
    parentId: "PU-02",
    branch: "Operaciones",
    processLinks: [{ processId: "P-04", relationship: "owner" }],
  },
  {
    id: "PU-27",
    name: "Jefe de Almacén MP/Refacc.",
    level: 4,
    parentId: "PU-02",
    branch: "Operaciones",
    processLinks: [
      { processId: "P-09", relationship: "owner" },
      { processId: "P-10", relationship: "participant" },
    ],
  },
  {
    id: "PU-28",
    name: "Promotoría",
    level: 4,
    parentId: "PU-24",
    branch: "Ventas",
    processLinks: [
      { processId: "P-01", relationship: "participant" },
      { processId: "P-33", relationship: "participant" },
    ],
  },
];

export function getPositionsForProcess(processId: string) {
  return organizationPositions.flatMap((position) =>
    position.processLinks
      .filter((link) => link.processId === processId)
      .map((link) => ({ position, relationship: link.relationship })),
  );
}

export function getPositionParent(position: OrganizationPosition) {
  return position.parentId
    ? organizationPositions.find((candidate) => candidate.id === position.parentId)
    : undefined;
}

export function getPositionReports(positionId: string) {
  return organizationPositions.filter((position) => position.parentId === positionId);
}
