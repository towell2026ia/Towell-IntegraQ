export const editableSpecificPermissionGroups = [
  {
    id: "usuarios",
    label: "Usuarios",
    permissions: [
      ["usuarios.ver", "Ver usuarios"],
      ["usuarios.crear", "Crear usuarios"],
      ["usuarios.editar", "Editar usuarios"],
      ["usuarios.desactivar", "Desactivar usuarios"],
      ["usuarios.administrar_permisos", "Administrar permisos"],
    ],
  },
  {
    id: "clientes",
    label: "Clientes",
    permissions: [
      ["clientes.acceder", "Acceder al módulo de clientes"],
      ["clientes.ver", "Ver clientes"],
      ["clientes.crear", "Crear clientes"],
      ["clientes.editar", "Editar clientes"],
      ["clientes.administrar", "Administrar clientes"],
    ],
  },
  {
    id: "portal_clientes",
    label: "Portal de clientes",
    permissions: [
      ["portal_clientes.acceder", "Acceder al Portal de Clientes"],
      ["portal_clientes.consultar_invitaciones", "Consultar invitaciones de clientes"],
      ["portal_clientes.emitir_invitaciones", "Emitir invitaciones de clientes"],
      ["portal_clientes.reenviar_invitaciones", "Reenviar invitaciones de clientes"],
      ["portal_clientes.revocar_invitaciones", "Revocar invitaciones de clientes"],
    ],
  },
  {
    id: "proveedores",
    label: "Proveedores",
    permissions: [
      ["proveedores.acceder", "Acceder al módulo de proveedores"],
      ["proveedores.ver", "Ver proveedores"],
      ["proveedores.crear", "Crear proveedores"],
      ["proveedores.editar", "Editar proveedores"],
      ["proveedores.administrar", "Administrar proveedores"],
    ],
  },
  {
    id: "portal_proveedores",
    label: "Portal de proveedores",
    permissions: [
      ["portal_proveedores.acceder", "Acceder al Portal de Proveedores"],
      ["portal_proveedores.consultar_invitaciones", "Consultar invitaciones de proveedores"],
      ["portal_proveedores.emitir_invitaciones", "Emitir invitaciones de proveedores"],
      ["portal_proveedores.reenviar_invitaciones", "Reenviar invitaciones de proveedores"],
      ["portal_proveedores.revocar_invitaciones", "Revocar invitaciones de proveedores"],
    ],
  },
  {
    id: "rncp",
    label: "Gestión de calidad de proveedores · RNCP",
    permissions: [
      ["rncp.consultar_rncp", "Consultar RNCP"],
      ["rncp.consultar_expedientes", "Consultar expedientes"],
      ["rncp.consultar_dashboards", "Consultar dashboards"],
      ["rncp.crear_rncp", "Crear RNCP"],
      ["rncp.editar_rncp", "Editar RNCP"],
      ["rncp.enviar_reclamos", "Enviar reclamos"],
      ["rncp.enviar_rncp", "Enviar RNCP por correo"],
      ["rncp.enviar_seguimientos", "Enviar reportes de seguimiento"],
      ["rncp.enviar_recordatorios", "Enviar recordatorios"],
      ["rncp.gestionar_planes", "Gestionar planes de acción"],
      ["rncp.revisar_evidencias", "Cargar y revisar evidencias"],
      ["rncp.validar_acciones", "Validar acciones correctivas"],
      ["rncp.verificar_efectividad", "Verificar efectividad"],
      ["rncp.cerrar_planes", "Cerrar planes de acción"],
      ["rncp.cerrar_rncp", "Cerrar RNCP"],
      ["rncp.reabrir_rncp", "Reabrir RNCP"],
      ["rncp.configurar_modulo", "Configurar Gestión de calidad de proveedores"],
    ],
  },
  {
    id: "revision_direccion",
    label: "Revisión por la Dirección",
    permissions: [
      ["revision_direccion.reabrir_acuerdos", "Reabrir acuerdos de Dirección"],
      ["revision_direccion.reabrir_acciones", "Reabrir acciones de acuerdos de Dirección"],
    ],
  },
  {
    id: "organigrama",
    label: "Organigrama",
    permissions: [
      ["organigrama.ver", "Ver organigramas"],
    ],
  },
  {
    id: "evidencias",
    label: "Evidencias",
    permissions: [
      ["evidencias.ver", "Ver y descargar"],
    ],
  },
] as const;

export type SpecificPermissionKey =
  (typeof editableSpecificPermissionGroups)[number]["permissions"][number][0];

export const editableSpecificPermissionKeys = editableSpecificPermissionGroups
  .flatMap((group) => group.permissions.map(([key]) => key));

export function isReopeningPermission(key: SpecificPermissionKey) {
  return key === "rncp.reabrir_rncp" || key === "revision_direccion.reabrir_acuerdos" || key === "revision_direccion.reabrir_acciones";
}

export type SpecificPermissionState = Partial<Record<SpecificPermissionKey, boolean>>;
