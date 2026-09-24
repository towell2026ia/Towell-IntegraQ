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
      ["portal_clientes.acceder", "Acceder al Portal de Clientes"],
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
      ["portal_proveedores.acceder", "Acceder al Portal de Proveedores"],
    ],
  },
  {
    id: "organigrama",
    label: "Organigrama",
    permissions: [
      ["organigrama.ver", "Ver organigramas"],
      ["organigrama.crear", "Crear organigramas"],
      ["organigrama.editar", "Actualizar organigramas"],
      ["organigrama.eliminar", "Eliminar organigramas"],
    ],
  },
  {
    id: "evidencias",
    label: "Evidencias",
    permissions: [
      ["evidencias.ver", "Ver y descargar"],
      ["evidencias.agregar", "Agregar"],
      ["evidencias.reemplazar", "Reemplazar"],
      ["evidencias.eliminar", "Eliminar"],
      ["evidencias.historial", "Ver histórico"],
    ],
  },
] as const;

export type SpecificPermissionKey =
  (typeof editableSpecificPermissionGroups)[number]["permissions"][number][0];

export const editableSpecificPermissionKeys = editableSpecificPermissionGroups
  .flatMap((group) => group.permissions.map(([key]) => key));

export type SpecificPermissionState = Partial<Record<SpecificPermissionKey, boolean>>;
