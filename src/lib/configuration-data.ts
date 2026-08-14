export type ProcessLevel = "process" | "subprocess";

export interface ProcessCatalogItem {
  id: string;
  name: string;
  level: ProcessLevel;
  parentId?: string;
  sourceLabel: string;
  representation: string;
  status: "Borrador" | "Validado" | "Aprobado";
  scope: "Por definir" | "Incluido" | "Solo referencia" | "Integración";
}

export const processCatalog: ProcessCatalogItem[] = [
  { id: "P-01", name: "Ventas", level: "process", sourceLabel: "Ventas", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-33", name: "Satisfacción al cliente", level: "subprocess", parentId: "P-01", sourceLabel: "Satisfacción al cliente", representation: "Círculo terminal", status: "Borrador", scope: "Por definir" },
  { id: "P-02", name: "Diseño", level: "process", sourceLabel: "Diseño", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-03", name: "Dirección", level: "process", sourceLabel: "Dirección", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-04", name: "Planeación", level: "process", sourceLabel: "Planeación", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-05", name: "SMA", level: "process", sourceLabel: "SMA", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-06", name: "Contabilidad", level: "process", sourceLabel: "Contabilidad", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-07", name: "Tecnologías de Información", level: "process", sourceLabel: "Tecnologías de Información", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-08", name: "Calidad", level: "process", sourceLabel: "Calidad", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-09", name: "Almacén", level: "process", sourceLabel: "Almacén", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-10", name: "Compras", level: "process", sourceLabel: "Compras", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-11", name: "Patrimonial", level: "process", sourceLabel: "Patrimonial", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-12", name: "Mantenimiento", level: "process", sourceLabel: "Mantenimiento", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-13", name: "Tejido", level: "process", sourceLabel: "Tejido", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-14", name: "Manufactura Urdido", level: "subprocess", parentId: "P-13", sourceLabel: "Manufactura Urdido", representation: "Círculo de manufactura", status: "Borrador", scope: "Por definir" },
  { id: "P-15", name: "Manufactura Engomado", level: "subprocess", parentId: "P-13", sourceLabel: "Manufactura Engomado", representation: "Círculo de manufactura", status: "Borrador", scope: "Por definir" },
  { id: "P-16", name: "Manufactura de Tejido", level: "subprocess", parentId: "P-13", sourceLabel: "Manufactura de Tejido", representation: "Círculo de manufactura", status: "Borrador", scope: "Por definir" },
  { id: "P-19", name: "Manufactura de rollo rasurado", level: "subprocess", parentId: "P-13", sourceLabel: "Manufactura de rollo rasurado", representation: "Círculo de manufactura", status: "Borrador", scope: "Por definir" },
  { id: "P-17", name: "Tintorería", level: "process", sourceLabel: "Tintorería / Crudo", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-20", name: "Manufactura de Toalla teñida", level: "subprocess", parentId: "P-17", sourceLabel: "Manufactura de Toalla teñida", representation: "Círculo de manufactura", status: "Borrador", scope: "Por definir" },
  { id: "P-21", name: "Manufactura de Toalla seca", level: "subprocess", parentId: "P-17", sourceLabel: "Manufactura de Toalla seca", representation: "Círculo de manufactura", status: "Borrador", scope: "Por definir" },
  { id: "P-18", name: "Laboratorio", level: "process", sourceLabel: "Laboratorio", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-22", name: "Costura", level: "process", sourceLabel: "Costura/Acabado", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-25", name: "Manufactura de Confección de la toalla", level: "subprocess", parentId: "P-22", sourceLabel: "Manufactura de Confección de la toalla", representation: "Círculo de manufactura", status: "Borrador", scope: "Por definir" },
  { id: "P-26", name: "Manufactura de Toalla estampada", level: "subprocess", parentId: "P-22", sourceLabel: "Manufactura de Toalla estampada", representation: "Círculo de manufactura", status: "Borrador", scope: "Por definir" },
  { id: "P-27", name: "Manufactura de Confección de Toalla", level: "subprocess", parentId: "P-22", sourceLabel: "Manufactura de Confección de Toalla", representation: "Círculo de manufactura", status: "Borrador", scope: "Por definir" },
  { id: "P-29", name: "Manufactura de Empaque final", level: "subprocess", parentId: "P-22", sourceLabel: "Manufactura de Empaque final", representation: "Círculo de manufactura", status: "Borrador", scope: "Por definir" },
  { id: "P-23", name: "Corte de Bata", level: "process", sourceLabel: "Corte de Bata", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-24", name: "Confección de Bata", level: "process", sourceLabel: "Confección de Bata", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-31", name: "Mesa de Control", level: "process", sourceLabel: "Mesa de Control", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-34", name: "PT", level: "process", sourceLabel: "Agrupador confirmado", representation: "Agrupador de proceso", status: "Borrador", scope: "Por definir" },
  { id: "P-28", name: "PT Cubo", level: "subprocess", parentId: "P-34", sourceLabel: "PT Cubo", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-30", name: "PT Preparación", level: "subprocess", parentId: "P-34", sourceLabel: "PT Preparación", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
  { id: "P-32", name: "PT Embarques", level: "subprocess", parentId: "P-34", sourceLabel: "PT Embarques", representation: "Círculo de inicio", status: "Borrador", scope: "Por definir" },
];

export const userTypeCatalog = [
  {
    id: "TU-ADM",
    name: "Administrador",
    defaultAccess: "Acceso total",
    processScope: "Todos los procesos",
    description: "Configura usuarios, permisos, procesos y módulos.",
    status: "Definido",
  },
  {
    id: "TU-USR",
    name: "Usuario",
    defaultAccess: "Sin permisos por defecto",
    processScope: "Solo procesos asignados",
    description: "Accede únicamente a módulos, acciones y procesos autorizados.",
    status: "Definido",
  },
] as const;

export const permissionAreaCatalog = [
  { id: "PER-MOD", name: "Acceso a módulos", administrator: "Todos", user: "Solo asignados", status: "Por diseñar" },
  { id: "PER-PRO", name: "Visibilidad de procesos", administrator: "Todos", user: "Solo asignados", status: "Por diseñar" },
  { id: "PER-DOC-V", name: "Ver documentación", administrator: "Permitido", user: "Según asignación", status: "Por diseñar" },
  { id: "PER-DOC-E", name: "Editar documentación", administrator: "Permitido", user: "Según asignación", status: "Por diseñar" },
  { id: "PER-DOC-A", name: "Autorizar documentación", administrator: "Permitido", user: "Según asignación", status: "Por diseñar" },
] as const;
