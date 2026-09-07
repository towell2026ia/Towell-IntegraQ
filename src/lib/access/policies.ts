import { permissionCatalog } from "./permissions";

export function getPermissionPolicy(code: string) {
  return permissionCatalog.find((permission) => permission.code === code) ?? null;
}

export function requiresExplicitConfirmation(code: string) {
  const policy = getPermissionPolicy(code);
  return policy?.riskLevel === "HIGH" || policy?.riskLevel === "CRITICAL";
}
