import "server-only";

import { createFingerprint, logAiActivity } from "./audit";
import { SupabaseAiActivitySink } from "./audit/supabase-sink";
import { canUseAiCapability, type AiPermission } from "./permissions";
import type { WorkspaceModuleId } from "@/lib/navigation";
import type { ActiveSession } from "@/lib/session-data";
import { createAdminClient } from "@/lib/supabase/admin";

export function authorizeLegacyAiRequest(user: ActiveSession, module: WorkspaceModuleId, requiredPermission: AiPermission, processId?: string) {
  return canUseAiCapability({ user, module, requiredPermissions: [requiredPermission], ...(processId ? { record: { processId } } : {}) });
}

export async function logLegacyAiRequest({ user, module, capability, input, context, recordType, recordId, requiresApproval = false }: { user: ActiveSession; module: WorkspaceModuleId; capability: string; input: unknown; context: unknown; recordType?: string; recordId?: string; requiresApproval?: boolean }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return;
  try {
    await logAiActivity(new SupabaseAiActivitySink(createAdminClient()), {
      requestId: crypto.randomUUID(),
      userId: user.authUserId ?? user.userId,
      module,
      recordType,
      recordId,
      capability,
      inputFingerprint: createFingerprint(input),
      contextFingerprint: createFingerprint(context),
      status: "processing",
      requiresApproval,
      metadata: { adapter: "legacy" },
    });
  } catch (error) {
    console.error("No fue posible registrar la trazabilidad de la API de IA existente.", error);
  }
}

