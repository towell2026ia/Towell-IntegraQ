import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

export async function decide(request: Request, { params }: { params: Promise<{ id: string }> }, decision: "approved" | "rejected") {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { comments?: string };
  if (decision === "rejected" && !body.comments?.trim()) return NextResponse.json({ success: false, error: "REASON_REQUIRED" }, { status: 400 });
  const { id } = await params;
  const supabase = await createClient();
  const result = await supabase.rpc("decide_approval", { request_id: id, requested_decision: decision, decision_comments: body.comments?.trim() || null });
  if (result.error) {
    const code = knownCode(result.error.message);
    return NextResponse.json({ success: false, error: code }, { status: code === "NOT_FOUND" ? 404 : code === "REASON_REQUIRED" ? 400 : code === "INVALID_STATE_TRANSITION" ? 409 : 403 });
  }
  const payload = result.data as { approval?: unknown; activityLogId?: string } | null;
  return NextResponse.json({ success: true, message: decision === "approved" ? "Solicitud aprobada." : "Solicitud rechazada.", entity: payload?.approval ?? result.data, activityLogId: payload?.activityLogId ?? null, approvalRequired: false, approvalRequestId: id });
}

function knownCode(message: string) {
  return ["NOT_FOUND", "REASON_REQUIRED", "INVALID_STATE_TRANSITION", "CONFLICT_OF_INTEREST", "OUTSIDE_SCOPE", "FORBIDDEN"].find((code) => message.includes(code)) ?? "FORBIDDEN";
}
