import type { ActiveSession, ModuleActionPermission } from "./session-data";
import { editableSpecificPermissionKeys, type SpecificPermissionKey, type SpecificPermissionState } from "./specific-permissions";
import type { WorkspaceModuleId } from "./navigation";

/** Legacy module grants are defaults; an explicit stored denial always wins. */
export function effectiveSpecificPermissions(session: Pick<ActiveSession, "userType" | "assignedModuleIds" | "moduleActionPermissions" | "specificPermissions">): SpecificPermissionState {
  return Object.fromEntries(editableSpecificPermissionKeys.map((key) => {
    if (session.userType === "Administrador") return [key, true];
    if (typeof session.specificPermissions?.[key] === "boolean") return [key, session.specificPermissions[key]];
    const mapped = specificPermissionModuleAction(key);
    const external = session.userType === "Cliente" || session.userType === "Proveedor";
    if (external || !mapped || key.startsWith("portal_")) return [key, false];
    return [key, mapped.action === "view"
      ? Boolean(session.assignedModuleIds?.includes(mapped.moduleId) || session.moduleActionPermissions?.some((p) => p.moduleId === mapped.moduleId))
      : Boolean(session.moduleActionPermissions?.some((p) => p.moduleId === mapped.moduleId && p.action === mapped.action))];
  }));
}
export function specificPermissionModuleAction(permission: SpecificPermissionKey): ModuleActionPermission | null {
  const [family, action] = permission.split(".");
  const modules: Record<string, WorkspaceModuleId> = { usuarios: "access", clientes: "customers", proveedores: "suppliers", portal_clientes: "customer-portal", portal_proveedores: "supplier-portal" };
  const moduleId = modules[family];
  if (!moduleId) return null;
  return { moduleId, action: action === "acceder" || action === "ver" ? "view" : action === "crear" ? "create" : action === "editar" || action === "desactivar" ? "update" : "manage" };
}
export function synchronizeSpecificPermissions(current: SpecificPermissionState, permission: ModuleActionPermission, enabled: boolean) {
  const next = { ...current };
  for (const key of editableSpecificPermissionKeys) {
    const mapped = specificPermissionModuleAction(key);
    if (mapped?.moduleId === permission.moduleId && (mapped.action === permission.action || (!enabled && permission.action === "view") || (enabled && mapped.action === "view"))) next[key] = enabled;
  }
  return next;
}
export function specificActionPermission(moduleId: WorkspaceModuleId, action: string): SpecificPermissionKey | null {
  const family = moduleId === "access" ? "usuarios" : moduleId === "customers" ? "clientes" : moduleId === "suppliers" ? "proveedores" : null;
  if (!family) return null;
  const suffix = action === "view" ? (family === "usuarios" ? "ver" : "acceder") : action === "create" ? "crear" : action === "update" ? "editar" : action === "manage" ? (family === "usuarios" ? "administrar_permisos" : "administrar") : null;
  return suffix ? `${family}.${suffix}` as SpecificPermissionKey : null;
}

export function changedSpecificPermissions(before: SpecificPermissionState, after: SpecificPermissionState): SpecificPermissionState {
  return Object.fromEntries(editableSpecificPermissionKeys.filter((key) => before[key] !== after[key]).map((key) => [key, Boolean(after[key])]));
}

export function rolePermissionDefaults(userId: string, companyId: string | undefined, assignments: unknown[], now = Date.now()): SpecificPermissionState {
  const state: SpecificPermissionState = {};
  for (const raw of assignments) {
    const assignment = raw as { user_id?: string; organization_id?: string; status?: string; starts_at?: string; ends_at?: string; role?: { status?: string; scope_type?: string; grants?: { allowed?: boolean; permission?: { code?: string; status?: string } }[] } };
    if (assignment.user_id !== userId || assignment.status !== "active" || (assignment.starts_at && Date.parse(assignment.starts_at) > now) || (assignment.ends_at && Date.parse(assignment.ends_at) < now)) continue;
    const role = assignment.role;
    if (role?.status !== "active" || !(role.scope_type === "global" || (role.scope_type === "company" && companyId && assignment.organization_id === companyId))) continue;
    for (const grant of role.grants ?? []) {
      const code = grant.permission?.code as SpecificPermissionKey;
      if (grant.allowed && grant.permission?.status === "active" && editableSpecificPermissionKeys.includes(code)) state[code] = true;
    }
  }
  return state;
}
