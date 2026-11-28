import type { SpecificPermissionState } from "../specific-permissions";
import type { ModuleActionPermission, ModulePermissionAction } from "../session-data";
import { editableSpecificPermissionGroups } from "../specific-permissions";

export const supplierLevels = ["Sin acceso", "Visualizador", "Editor", "Gestor", "Administrador"] as const;
export type SupplierLevel = typeof supplierLevels[number];

export function applySupplierLevel(level: SupplierLevel, permissions: SpecificPermissionState, modules: ModuleActionPermission[]) {
  const index = supplierLevels.indexOf(level);
  const read = index >= 1, edit = index >= 2, manage = index >= 3;
  const next = { ...permissions };
  for (const group of editableSpecificPermissionGroups) {
    if (!["proveedores", "rncp", "portal_proveedores"].includes(group.id)) continue;
    for (const [key] of group.permissions) {
      if (key.startsWith("rncp.consultar_") || ["proveedores.acceder","proveedores.ver","portal_proveedores.acceder","portal_proveedores.consultar_invitaciones"].includes(key)) next[key] = read;
      else if (key === "rncp.configurar_modulo") next[key] = index === 4;
      else if (key === "portal_proveedores.revocar_invitaciones" || key === "proveedores.administrar") next[key] = manage;
      else if (["rncp.validar_acciones","rncp.verificar_efectividad","rncp.cerrar_planes","rncp.cerrar_rncp","rncp.reabrir_rncp"].includes(key)) next[key] = false;
      else next[key] = edit;
    }
  }
  const actions: ModulePermissionAction[] = read ? ["view"] : [];
  if (edit) actions.push("create","update");
  if (manage) actions.push("manage");
  const assignments = modules.filter(item => item.moduleId !== "suppliers" && item.moduleId !== "supplier-portal");
  for (const action of actions) assignments.push({moduleId:"suppliers",action});
  if (read) assignments.push({moduleId:"supplier-portal",action:"view"});
  return { permissions: next, modules: assignments };
}
