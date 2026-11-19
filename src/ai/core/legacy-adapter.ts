import "server-only";

import { createFingerprint, logAiActivity } from "./audit";
import { SupabaseAiActivitySink } from "./audit/supabase-sink";
import { canUseAiCapability, type AiPermission } from "./permissions";
import type { WorkspaceModuleId } from "@/lib/navigation";
import type { ActiveSession } from "@/lib/session-data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AiActivityEvent } from "./audit/types";

export function authorizeLegacyAiRequest(user: ActiveSession, module: WorkspaceModuleId, requiredPermission: AiPermission, processId?: string) {
  return canUseAiCapability({ user, module, requiredPermissions: [requiredPermission], ...(processId ? { record: { processId } } : {}) });
}

export async function logLegacyAiRequest({ user, module, capability, input, context, recordType, recordId, requiresApproval = false, status = "processing", model, provider, metadata = {} }: { user: ActiveSession; module: WorkspaceModuleId; capability: string; input: unknown; context: unknown; recordType?: string; recordId?: string; requiresApproval?: boolean; status?: AiActivityEvent["status"]; model?: string; provider?: string; metadata?: Record<string, unknown> }) {
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
      status,
      model,
      provider,
      requiresApproval,
      metadata: { adapter: "legacy", ...metadata },
    });
  } catch (error) {
    console.error("No fue posible registrar la trazabilidad de la API de IA existente.", error);
  }
}

