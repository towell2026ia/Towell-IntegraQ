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
    initialCount: "2 usuarios",
    defaultAccess: "Acceso total",
    processScope: "Todos los procesos",
    description: "Administra módulos, empresas, permisos, versiones y configuraciones.",
    status: "Definido",
  },
  {
    id: "TU-INT",
    name: "Usuario interno",
    initialCount: "Según necesidad",
    defaultAccess: "Sin permisos por defecto",
    processScope: "Solo procesos asignados",
    description: "Accede según puesto, área, proceso, rol y permisos asignados.",
    status: "Definido",
  },
  {
    id: "TU-CLI",
    name: "Cliente",
    initialCount: "Según clientes",
    defaultAccess: "Solo Portal del cliente",
    processScope: "Sin acceso a procesos internos",
    description: "Consulta únicamente registros vinculados con el ID de su empresa cliente.",
    status: "Definido",
  },
  {
    id: "TU-PRO",
    name: "Proveedor",
    initialCount: "Según proveedores",
    defaultAccess: "Solo Portal de proveedores",
    processScope: "Sin acceso a procesos internos",
    description: "Consulta únicamente registros vinculados con el ID de su empresa proveedora.",
    status: "Definido",
  },
] as const;

export const permissionAreaCatalog = [
  { id: "PER-01", name: "Acceder al portal", administrator: "Sí", internalUser: "Sí", customer: "Solo su portal", supplier: "Solo su portal" },
  { id: "PER-02", name: "Ver inicio y avisos", administrator: "Toda la organización", internalUser: "Área y procesos", customer: "Solo su empresa", supplier: "Solo su empresa" },
  { id: "PER-03", name: "Administrar usuarios", administrator: "Sí", internalUser: "No", customer: "No", supplier: "No" },
  { id: "PER-04", name: "Crear usuarios", administrator: "Sí", internalUser: "No", customer: "No", supplier: "No" },
  { id: "PER-05", name: "Asignar roles y permisos", administrator: "Sí", internalUser: "No", customer: "No", supplier: "No" },
  { id: "PER-06", name: "Configurar empresas, áreas y organigrama", administrator: "Sí", internalUser: "No", customer: "No", supplier: "No" },
  { id: "PER-07", name: "Ver procesos", administrator: "Todos", internalUser: "Según permiso", customer: "No", supplier: "No" },
  { id: "PER-08", name: "Ver documentos", administrator: "Todos", internalUser: "Autorizados", customer: "Vinculados", supplier: "Vinculados" },
  { id: "PER-09", name: "Crear documentos internos", administrator: "Sí", internalUser: "Según permiso", customer: "No", supplier: "No" },
  { id: "PER-10", name: "Editar documentos internos", administrator: "Sí", internalUser: "Propios o asignados", customer: "No", supplier: "No" },
  { id: "PER-11", name: "Descargar documentos", administrator: "Sí", internalUser: "Según permiso", customer: "Solo compartidos", supplier: "Solo compartidos" },
  { id: "PER-12", name: "Ver versiones anteriores", administrator: "Sí", internalUser: "Permiso especial", customer: "No", supplier: "No" },
  { id: "PER-13", name: "Enviar a validación", administrator: "Sí", internalUser: "Propios o asignados", customer: "No", supplier: "No" },
  { id: "PER-14", name: "Aprobar o rechazar documentos", administrator: "Sí", internalUser: "Validador autorizado", customer: "No", supplier: "No" },
  { id: "PER-15", name: "Cargar evidencias o archivos", administrator: "Sí", internalUser: "Según proceso", customer: "Solo sus registros", supplier: "Solo sus registros" },
  { id: "PER-16", name: "Crear riesgos, hallazgos o acciones", administrator: "Sí", internalUser: "Según permiso", customer: "No", supplier: "No" },
  { id: "PER-17", name: "Atender acciones asignadas", administrator: "Sí", internalUser: "Sí", customer: "Solo su empresa", supplier: "Solo su empresa" },
  { id: "PER-18", name: "Participar en auditorías", administrator: "Sí", internalUser: "Si está asignado", customer: "Solo autorizadas", supplier: "Solo autorizadas" },
  { id: "PER-19", name: "Ver indicadores y reportes", administrator: "Todos", internalUser: "Área o proceso", customer: "Solo compartidos", supplier: "Solo compartidos" },
  { id: "PER-20", name: "Exportar información", administrator: "Sí", internalUser: "Según permiso", customer: "Solo autorizada", supplier: "Solo autorizada" },
  { id: "PER-21", name: "Recibir notificaciones", administrator: "Todas", internalUser: "Propias y asignadas", customer: "Solo su empresa", supplier: "Solo su empresa" },
  { id: "PER-22", name: "Consultar bitácora", administrator: "Solo lectura", internalUser: "Actividad propia autorizada", customer: "No", supplier: "No" },
  { id: "PER-23", name: "Configurar catálogos y sistema", administrator: "Sí", internalUser: "No", customer: "No", supplier: "No" },
  { id: "PER-24", name: "Desactivar usuarios", administrator: "Sí", internalUser: "No", customer: "No", supplier: "No" },
  { id: "PER-25", name: "Registrar proyectos de mejora", administrator: "Sí", internalUser: "Procesos asignados", customer: "No", supplier: "No" },
  { id: "PER-26", name: "Consultar proyectos de mejora", administrator: "Todos", internalUser: "Propios o asignados", customer: "No", supplier: "No" },
  { id: "PER-27", name: "Clasificar y ponderar proyectos", administrator: "Sí", internalUser: "Encargado de Mejora continua", customer: "No", supplier: "No" },
  { id: "PER-28", name: "Autorizar fases y cerrar proyectos", administrator: "Sí", internalUser: "Encargado de Mejora continua", customer: "No", supplier: "No" },
] as const;

export const accessRuleCatalog = [
  { id: "REG-01", rule: "Existirán inicialmente dos cuentas de administrador con acceso total." },
  { id: "REG-02", rule: "Cada usuario interno se vincula con puesto, área, proceso y permisos." },
  { id: "REG-03", rule: "Dueño de proceso, validador, auditor y responsable de acción son roles adicionales, no tipos de usuario." },
  { id: "REG-04", rule: "Cada cliente y proveedor se vincula con un ID único de empresa." },
  { id: "REG-05", rule: "El cliente solo puede consultar, cargar, descargar o responder registros de su empresa." },
  { id: "REG-06", rule: "El proveedor solo puede consultar, cargar, descargar o responder registros de su empresa." },
  { id: "REG-07", rule: "Un cliente no puede acceder a otros clientes, proveedores ni información interna no compartida." },
  { id: "REG-08", rule: "Un proveedor no puede acceder a otros proveedores, clientes ni información interna no compartida." },
  { id: "REG-09", rule: "Toda operación externa debe validar el ID de empresa." },
  { id: "REG-10", rule: "Conocer un enlace, folio o identificador ajeno no concede acceso al registro." },
  { id: "REG-11", rule: "Los permisos se aplican en interfaz, backend y base de datos." },
  { id: "REG-12", rule: "Consultas, descargas, cargas, aprobaciones, rechazos y cambios generan bitácora." },
  { id: "REG-13", rule: "La bitácora histórica es de solo lectura, incluso para administradores." },
  { id: "REG-14", rule: "Los usuarios con actividad histórica se desactivan; no se eliminan." },
  { id: "REG-15", rule: "Cada usuario recibe únicamente el acceso mínimo necesario." },
  { id: "REG-16", rule: "Todo usuario interno puede registrar proyectos de mejora para sus procesos asignados." },
  { id: "REG-17", rule: "El rol funcional Encargado de Mejora continua clasifica, pondera, autoriza fases y cierra proyectos." },
  { id: "REG-18", rule: "Los proyectos de mejora se clasifican únicamente como Kaizen o DMAIC." },
] as const;
