import type { WorkspaceModuleId } from "@/lib/navigation";
import type { ActiveSession } from "@/lib/session-data";

export const aiPermissionValues = ["ai.read", "ai.suggest", "ai.generate_draft", "ai.execute", "ai.approve", "ai.admin"] as const;
export type AiPermission = typeof aiPermissionValues[number];

export interface AiPermissionDecision {
  allowed: boolean;
  reason: string;
  grantedPermissions: AiPermission[];
}

export interface AiPermissionSubject {
  user: ActiveSession;
  module: WorkspaceModuleId;
  requiredPermissions: AiPermission[];
  record?: { processId?: string };
}

