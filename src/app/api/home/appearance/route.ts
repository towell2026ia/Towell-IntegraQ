import { NextResponse } from "next/server";
import { HOME_APPEARANCE_AREA, isHomeTextSize, readHomeTextSize } from "@/lib/home-appearance";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
import { isAdministrator, isExternalUser } from "@/lib/session-data";

async function resolveActor() {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) return { response: NextResponse.json({ error: "Sesión requerida." }, { status: 401 }) };
  if (isExternalUser(session)) return { response: NextResponse.json({ error: "Acceso no autorizado." }, { status: 403 }) };
  const supabase = await createClient();
  const profile = await supabase.from("profiles").select("organization_id,workspace_mode,status,user_type").eq("id", session.authUserId).maybeSingle();
  if (profile.error || !profile.data || profile.data.status !== "active" || !profile.data.organization_id || !["production", "demo"].includes(profile.data.workspace_mode)) {
    return { response: NextResponse.json({ error: "No se pudo verificar el espacio autorizado." }, { status: 403 }) };
  }
  return { supabase, userId: session.authUserId, workspaceId: profile.data.organization_id, workspaceMode: profile.data.workspace_mode,
    administrator: isAdministrator(session) && profile.data.user_type === "administrator" };
}
async function readRow(actor: Awaited<ReturnType<typeof resolveActor>>) {
  return actor.supabase!.from("workspace_data").select("id,payload,revision")
    .eq("workspace_id", actor.workspaceId).eq("workspace_mode", actor.workspaceMode)
    .eq("area", HOME_APPEARANCE_AREA).is("deleted_at", null).maybeSingle();
}
export async function GET() {
  try {
    const actor = await resolveActor(); if (actor.response) return actor.response;
    const result = await readRow(actor);
    if (result.error) throw result.error;
    return NextResponse.json({ textSize: readHomeTextSize(result.data?.payload), revision: result.data?.revision ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "No fue posible consultar la apariencia de Inicio." }, { status: 500 }); }
}
export async function PATCH(request: Request) {
  try {
    const actor = await resolveActor(); if (actor.response) return actor.response;
    if (!actor.administrator) return NextResponse.json({ error: "Sólo el administrador puede cambiar la apariencia." }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (!body || !isHomeTextSize(body.textSize) || !Number.isInteger(body.revision) || body.revision < 0) return NextResponse.json({ error: "Tamaño o revisión no válidos." }, { status: 400 });
    const existing = await readRow(actor);
    if (existing.error) throw existing.error;
    if ((existing.data?.revision ?? 0) !== body.revision) return NextResponse.json({ error: "La configuración cambió. Recarga antes de guardar." }, { status: 409 });
    const payload = { ...(existing.data?.payload ?? {}), textSize: body.textSize };
    const query = existing.data
      ? actor.supabase!.from("workspace_data").update({ payload, updated_by: actor.userId })
        .eq("id", existing.data.id).eq("workspace_id", actor.workspaceId).eq("workspace_mode", actor.workspaceMode)
        .eq("area", HOME_APPEARANCE_AREA).eq("revision", body.revision).is("deleted_at", null)
      : actor.supabase!.from("workspace_data").insert({ workspace_id: actor.workspaceId, workspace_mode: actor.workspaceMode, area: HOME_APPEARANCE_AREA, payload, created_by: actor.userId, updated_by: actor.userId });
    const saved = await query.select("payload,revision").maybeSingle();
    if (saved.error?.code === "23505" || (!saved.error && !saved.data)) return NextResponse.json({ error: "La configuración cambió. Recarga antes de guardar." }, { status: 409 });
    if (saved.error) throw saved.error;
    if (!saved.data) throw new Error("No se guardó la configuración.");
    return NextResponse.json({ textSize: readHomeTextSize(saved.data.payload), revision: saved.data.revision });
  } catch { return NextResponse.json({ error: "No fue posible guardar la apariencia de Inicio." }, { status: 500 }); }
}