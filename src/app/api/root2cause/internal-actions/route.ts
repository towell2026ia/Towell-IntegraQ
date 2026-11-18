import { NextResponse } from "next/server";

import { canPerformModuleAction } from "@/lib/module-permissions";
import { correctiveActionColumns, correctiveActionFlowColumns } from "@/lib/corrective-action-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";

const pageSize = 500;

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session?.organizationId || session.workspaceMode === "demo" ||
    !["Administrador", "Usuario interno"].includes(session.userType) ||
    !canPerformModuleAction(session, "corrective-actions", "view")) {
    return NextResponse.json({ error: "No tienes permiso para consultar Root2Cause." }, { status: 403 });
  }

  const admin = createAdminClient();
  const rows: Record<string, unknown>[] = [];
  const allowedProcesses = new Set(session.assignedProcessIds);
  for (let start = 0; ; start += pageSize) {
    const scoped = admin.from("corrective_actions").select(correctiveActionFlowColumns)
      .eq("organization_id", session.organizationId).is("deleted_at", null)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(start, start + pageSize - 1);
    let result = await scoped as unknown as { data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null };
    if (result.error && (result.error.code === "42703" || result.error.code === "PGRST204" || /column .* does not exist/i.test(result.error.message ?? ""))) {
      result = await admin.from("corrective_actions").select(correctiveActionColumns)
        .eq("organization_id", session.organizationId).is("deleted_at", null)
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(start, start + pageSize - 1) as unknown as typeof result;
    }
    if (result.error) return NextResponse.json({ error: "No fue posible consultar Root2Cause." }, { status: 500 });
    const page = (result.data ?? []) as Record<string, unknown>[];
    rows.push(...page.filter((row) => !row.deleted_at && row.organization_id === session.organizationId &&
      (session.userType === "Administrador" || !row.process_id || allowedProcesses.has(String(row.process_id)))));
    if (page.length < pageSize) break;
  }
  return NextResponse.json({ actions: rows }, { headers: { "Cache-Control": "private, no-store" } });
}
