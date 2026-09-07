import { SupabaseAiActivitySink } from "@/ai/core/audit/supabase-sink";
import { SupabaseContextRepository } from "@/ai/core/context/supabase-repository";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";

import { handleExecuteAiRequest } from "./handler";

export const maxDuration = 30;

export async function POST(request: Request) {
  const admin = createAdminClient();
  return handleExecuteAiRequest(request, {
    getSession: getAuthenticatedSession,
    repository: new SupabaseContextRepository(admin),
    auditSink: new SupabaseAiActivitySink(admin),
  });
}

