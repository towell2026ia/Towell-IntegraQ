import type { WorkspaceModuleId } from "@/lib/navigation";

import type { AiPermission } from "../permissions";

export type AiCapabilityStatus = "enabled" | "disabled";

export interface AiCapabilityDefinition {
  id: string;
  name: string;
  module: WorkspaceModuleId;
  status: AiCapabilityStatus;
  requiredPermissions: AiPermission[];
  requiresApproval: boolean;
}

