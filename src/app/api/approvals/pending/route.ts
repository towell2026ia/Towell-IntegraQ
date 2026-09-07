import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const userId = session.authUserId ?? session.userId;
  const supabase = await createClient();
  const result = await supabase.from("approval_requests").select("*").eq("status", "pending").or(`assigned_approver_id.eq.${userId},assigned_approver_id.is.null`).order("requested_at");
  if (result.error) return NextResponse.json({ error: "APPROVAL_QUERY_FAILED" }, { status: 500 });
  return NextResponse.json({ approvals: result.data ?? [], count: result.data?.length ?? 0 });
}
