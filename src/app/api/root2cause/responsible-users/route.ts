import { NextResponse } from "next/server";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { canAccessProcess, isExternalUser } from "@/lib/session-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId || isExternalUser(session) || session.workspaceMode === "demo" ||
      !canPerformModuleAction(session, "corrective-actions", "view")) {
    return NextResponse.json({ error: "Se requiere acceso interno autorizado a Root2Cause." }, { status: 403, headers: noStore });
  }

  const processId = new URL(request.url).searchParams.get("processId")?.trim() || null;
  if (processId && !canAccessProcess(session, processId)) {
    return NextResponse.json({ error: "No tienes acceso al proceso seleccionado." }, { status: 403, headers: noStore });
  }

  const admin = createAdminClient();
  const actor = await admin.from("profiles")
    .select("organization_id,user_type,status,workspace_mode")
    .eq("id", session.authUserId).maybeSingle();
  const expectedRole = session.userType === "Administrador" ? "administrator" : "internal";
  if (actor.error || actor.data?.user_type !== expectedRole || actor.data.status !== "active" ||
      actor.data.workspace_mode !== "production" || !actor.data.organization_id) {
    return NextResponse.json({ error: "El perfil interno no tiene un ámbito de trabajo válido." }, { status: 403, headers: noStore });
  }

  try {
    let processUserIds: string[] | null = null;
    if (processId) {
      const process = await admin.from("processes").select("id,process_owner_user_id")
        .eq("id", processId).eq("organization_id", actor.data.organization_id).maybeSingle();
      if (process.error || !process.data) return NextResponse.json({ error: "El proceso no pertenece a la organización autorizada." }, { status: 403, headers: noStore });
      const assigned = await admin.from("user_process_permissions").select("user_id").eq("process_id", processId);
      if (assigned.error) return NextResponse.json({ error: "No se pudo consultar el catálogo de responsables." }, { status: 503, headers: noStore });
      processUserIds = [...new Set([...(assigned.data ?? []).map(row => row.user_id), process.data.process_owner_user_id].filter((id): id is string => Boolean(id)))];
    }

    const query = admin.from("profiles").select("id,full_name,user_type")
      .eq("organization_id", actor.data.organization_id).eq("status", "active")
      .eq("workspace_mode", "production").in("user_type", ["internal", "administrator"])
      .order("full_name");
    if (processUserIds) {
      // Administrators are organization-scoped; internal users must be assigned to the selected process.
      const result = await query;
      if (result.error) return NextResponse.json({ error: "No se pudo consultar el catálogo de responsables." }, { status: 503, headers: noStore });
      const allowedIds = new Set([...processUserIds, ...(result.data ?? []).filter(user => user.user_type === "administrator").map(user => user.id)]);
      return NextResponse.json({ users: (result.data ?? []).filter(user => allowedIds.has(user.id)).map(user => ({ id: user.id, fullName: user.full_name })) }, { headers: noStore });
    }
    const result = await query;
    if (result.error) return NextResponse.json({ error: "No se pudo consultar el catálogo de responsables." }, { status: 503, headers: noStore });
    return NextResponse.json({ users: (result.data ?? []).map(user => ({ id: user.id, fullName: user.full_name })) }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "No se pudo consultar el catálogo de responsables." }, { status: 503, headers: noStore });
  }
}
