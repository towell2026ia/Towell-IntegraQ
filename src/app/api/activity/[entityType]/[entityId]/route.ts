import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ entityType: string; entityId: string }> }) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { entityType, entityId } = await params;
  const supabase = await createClient();
  const result = await supabase.from("audit_log").select("*").eq("resource_type", entityType).eq("resource_id", entityId).order("created_at", { ascending: false });
  if (result.error) return NextResponse.json({ error: "ACTIVITY_QUERY_FAILED" }, { status: 500 });
  return NextResponse.json({ activity: result.data ?? [] });
}
