import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import type { AiActivityEvent, AiActivitySink } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

export class SupabaseAiActivitySink implements AiActivitySink {
  constructor(private readonly admin: AdminClient) {}

  async write(event: AiActivityEvent) {
    const result = await this.admin.from("ai_activity_log").insert({
      request_id: event.requestId,
      user_id: event.userId,
      module: event.module,
      record_type: event.recordType ?? null,
      record_id: event.recordId ?? null,
      capability: event.capability,
      input_fingerprint: event.inputFingerprint,
      context_fingerprint: event.contextFingerprint,
      status: event.status,
      response_type: event.responseType ?? null,
      model: event.model ?? null,
      provider: event.provider ?? null,
      requires_approval: event.requiresApproval,
      approved_by: event.approvedBy ?? null,
      approved_at: event.approvedAt ?? null,
      metadata: event.metadata ?? {},
    });
    if (!result.error) return;
    if (!["42P01", "PGRST205"].includes(result.error.code ?? "")) throw result.error;
    const fallback = await this.admin.from("audit_log").insert({
      actor_id: event.userId,
      action: "ai.activity",
      resource_type: event.recordType ?? "ai_request",
      resource_id: event.recordId ?? null,
      metadata: {
        request_id: event.requestId,
        module: event.module,
        capability: event.capability,
        input_fingerprint: event.inputFingerprint,
        context_fingerprint: event.contextFingerprint,
        status: event.status,
        response_type: event.responseType ?? null,
        requires_approval: event.requiresApproval,
        ...event.metadata,
      },
    });
    if (fallback.error) throw fallback.error;
  }
}
