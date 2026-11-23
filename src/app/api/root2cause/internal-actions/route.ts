import { NextResponse } from "next/server";

import { canPerformModuleAction } from "@/lib/module-permissions";
import { correctiveActionColumns, correctiveActionFlowColumns, correctiveActionPlanColumns } from "@/lib/corrective-action-query";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";

const pageSize = 500;

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session?.organizationId || session.workspaceMode === "demo" ||
    !["Administrador", "Usuario interno"].includes(session.userType) ||
    !canPerformModuleAction(session, "corrective-actions", "view")) {
    return NextResponse.json({ error: "No tienes permiso para consultar Root2Cause." }, { status: 403 });
  }

  const db = await createClient();
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; ; start += pageSize) {
    const fetchPage = (columns: string) => db.from("corrective_actions").select(columns + ",iq_u08_case_visible")
      .eq("iq_u08_case_visible", true)
      .eq("organization_id", session.organizationId).is("deleted_at", null)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(start, start + pageSize - 1);
    let result = await fetchPage(correctiveActionPlanColumns);
    for (const columns of [correctiveActionFlowColumns, correctiveActionColumns]) {
      if (!result.error || !(["42703", "PGRST204"].includes(result.error.code) || /column .* does not exist/i.test(result.error.message))) break;
      result = await fetchPage(columns);
    }
    if (result.error) return NextResponse.json({ error: "No fue posible consultar Root2Cause." }, { status: 500 });
    const page = (result.data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page.filter(row => !row.deleted_at && row.organization_id === session.organizationId && row.iq_u08_case_visible === true)
      .map(row => ({ ...row, read_authorized_for: session.authUserId })));
    if (page.length < pageSize) break;
  }
  return NextResponse.json({ actions: rows }, { headers: { "Cache-Control": "private, no-store" } });
}
