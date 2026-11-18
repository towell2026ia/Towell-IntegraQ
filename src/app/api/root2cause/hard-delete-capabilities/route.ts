import { NextResponse } from "next/server";

import { canHardDeleteCorrectiveAction } from "@/lib/root2cause/hard-delete";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  if (process.env.ROOT2CAUSE_HARD_DELETE_ENABLED !== "true") {
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const session = await getAuthenticatedSession();
  if (!session?.authUserId || !canHardDeleteCorrectiveAction(session)) {
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const db = await createClient();
    const result = await db.rpc("iq_root2cause_hard_delete_contract");
    return NextResponse.json({ enabled: !result.error && result.data === true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
