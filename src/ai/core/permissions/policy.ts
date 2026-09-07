import { canAccessModule } from "@/lib/access-policy";
import { canPerformModuleAction } from "@/lib/module-permissions";
import type { WorkspaceModuleId } from "@/lib/navigation";
import { canAccessProcess, isAdministrator, type ActiveSession } from "@/lib/session-data";

import type { AiPermission, AiPermissionDecision, AiPermissionSubject } from "./types";

export function getAiPermissions(user: ActiveSession, module: WorkspaceModuleId): AiPermission[] {
  if (isAdministrator(user)) return ["ai.read", "ai.suggest", "ai.generate_draft", "ai.execute", "ai.approve", "ai.admin"];
  if (!canAccessModule(user, module)) return [];
  const permissions: AiPermission[] = ["ai.read"];
  if (canPerformModuleAction(user, module, "view")) permissions.push("ai.suggest");
  if (["create", "update", "manage"].some((action) => canPerformModuleAction(user, module, action as "create" | "update" | "manage"))) permissions.push("ai.generate_draft");
  if (canPerformModuleAction(user, module, "manage")) permissions.push("ai.execute");
  if (["review", "approve", "manage"].some((action) => canPerformModuleAction(user, module, action as "review" | "approve" | "manage"))) permissions.push("ai.approve");
  return [...new Set(permissions)];
}

export function canUseAiCapability(subject: AiPermissionSubject): AiPermissionDecision {
  const grantedPermissions = getAiPermissions(subject.user, subject.module);
  if (subject.record?.processId && !canAccessProcess(subject.user, subject.record.processId)) {
    return { allowed: false, reason: "El usuario no tiene acceso al proceso relacionado con el registro.", grantedPermissions };
  }
  const missing = subject.requiredPermissions.filter((permission) => !grantedPermissions.includes(permission));
  return missing.length
    ? { allowed: false, reason: `Faltan permisos de inteligencia: ${missing.join(", ")}.`, grantedPermissions }
    : { allowed: true, reason: "Permisos de inteligencia autorizados.", grantedPermissions };
}

