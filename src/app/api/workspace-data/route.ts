import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
import { isAdministrator, isExternalUser } from "@/lib/session-data";
import { isWorkspaceDataArea, workspaceDataAreas } from "@/lib/workspace-data";

type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  workspaceMode: "demo" | "production";
  administrator: boolean;
};

async function resolveContext(): Promise<WorkspaceContext | NextResponse> {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
  if (isExternalUser(session)) return NextResponse.json({ error: "El repositorio operativo es sólo para personal autorizado." }, { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id,workspace_mode")
    .eq("id", session.authUserId)
    .single();
  if (error || !data?.organization_id) {
    return NextResponse.json({ error: "La cuenta no tiene un espacio organizacional asignado." }, { status: 409 });
  }
  return {
    userId: session.authUserId,
    workspaceId: String(data.organization_id),
    workspaceMode: data.workspace_mode === "demo" ? "demo" : "production",
    administrator: isAdministrator(session),
  };
}

export async function GET(request: Request) {
  const context = await resolveContext();
  if (context instanceof NextResponse) return context;
  const includeDeleted = new URL(request.url).searchParams.get("includeDeleted") === "1";
  if (includeDeleted && !context.administrator) {
    return NextResponse.json({ error: "Sólo un administrador puede consultar eliminados." }, { status: 403 });
  }
  const supabase = await createClient();
  let query = supabase
    .from("workspace_data")
    .select("area,payload,revision,updated_at,deleted_at,deletion_reason")
    .eq("workspace_id", context.workspaceId)
    .eq("workspace_mode", context.workspaceMode)
    .in("area", [...workspaceDataAreas]);
  if (!includeDeleted && !context.administrator) query = query.is("deleted_at", null);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    data: Object.fromEntries((data ?? []).map((row) => [row.area, row.deleted_at ? null : row.payload])),
    records: data ?? [],
  });
}

export async function PUT(request: Request) {
  const context = await resolveContext();
  if (context instanceof NextResponse) return context;
  const body = (await request.json().catch(() => null)) as { area?: unknown; data?: unknown } | null;
  if (!body || !isWorkspaceDataArea(body.area) || body.data === undefined) {
    return NextResponse.json({ error: "Área o datos inválidos." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("workspace_data")
    .select("id,deleted_at")
    .eq("workspace_id", context.workspaceId)
    .eq("workspace_mode", context.workspaceMode)
    .eq("area", body.area)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (existing?.deleted_at) return NextResponse.json({ error: "El área está eliminada y debe restaurarse antes de modificarla." }, { status: 409 });

  const mutation = existing
    ? supabase.from("workspace_data").update({ payload: body.data, updated_by: context.userId }).eq("id", existing.id)
    : supabase.from("workspace_data").insert({
        workspace_id: context.workspaceId,
        workspace_mode: context.workspaceMode,
        area: body.area,
        payload: body.data,
        created_by: context.userId,
        updated_by: context.userId,
      });
  const { error } = await mutation;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
  if (!isAdministrator(session)) return NextResponse.json({ error: "Sólo un administrador puede eliminar o restaurar." }, { status: 403 });
  const context = await resolveContext();
  if (context instanceof NextResponse) return context;
  const body = (await request.json().catch(() => null)) as { area?: unknown; action?: unknown; reason?: unknown } | null;
  if (!body || !isWorkspaceDataArea(body.area) || (body.action !== "delete" && body.action !== "restore")) {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  if (body.action === "delete" && (typeof body.reason !== "string" || !body.reason.trim())) {
    return NextResponse.json({ error: "La eliminación lógica requiere un motivo." }, { status: 400 });
  }

  const supabase = await createClient();
  const changes = body.action === "delete"
    ? { deleted_at: new Date().toISOString(), deleted_by: context.userId, deletion_reason: String(body.reason).trim(), updated_by: context.userId }
    : { deleted_at: null, deleted_by: null, deletion_reason: null, updated_by: context.userId };
  const { error } = await supabase
    .from("workspace_data")
    .update(changes)
    .eq("workspace_id", context.workspaceId)
    .eq("workspace_mode", context.workspaceMode)
    .eq("area", body.area);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
