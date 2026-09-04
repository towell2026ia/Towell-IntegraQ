import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ensureMetrologyWorkspace, isMetrologyWorkspace, prepareMetrologyWorkspace, type MetrologyActor } from "@/lib/metrology-workspace-server";

export const maxDuration = 30;

async function requireActor(requireWrite = false): Promise<MetrologyActor | null> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const admin = createAdminClient();
  const profile = await admin.from("profiles").select("user_type,status").eq("id", userData.user.id).maybeSingle();
  if (profile.error || !profile.data || profile.data.status !== "active" || !["administrator", "internal"].includes(profile.data.user_type)) return null;
  const actor = { id: userData.user.id, userType: profile.data.user_type as MetrologyActor["userType"] };
  if (!requireWrite || actor.userType === "administrator") return actor;
  const [actions, modulePermission] = await Promise.all([
    admin.from("user_module_action_permissions").select("action").eq("user_id", actor.id).eq("module_id", "calibrations").in("action", ["create", "update", "manage"]).limit(1),
    admin.from("user_module_permissions").select("can_manage").eq("user_id", actor.id).eq("module_id", "calibrations").maybeSingle(),
  ]);
  if (actions.error || modulePermission.error) return null;
  return actions.data?.length || modulePermission.data?.can_manage ? actor : null;
}

export async function GET() {
  try {
    const actor = await requireActor();
    if (!actor) return NextResponse.json({ error: "Acceso interno requerido." }, { status: 403 });
    const record = await ensureMetrologyWorkspace(actor);
    return NextResponse.json({ workspace: record.values, updatedAt: record.updated_at, storage: "supabase" });
  } catch (error) {
    console.error("No fue posible cargar el expediente de metrología.", error);
    return NextResponse.json({ error: "No fue posible cargar el expediente de metrología." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireActor(true);
    if (!actor) return NextResponse.json({ error: "No tienes permiso para guardar verificaciones o calibraciones." }, { status: 403 });
    const payload = await request.json() as { workspace?: unknown };
    if (!isMetrologyWorkspace(payload.workspace)) return NextResponse.json({ error: "El expediente enviado no tiene una estructura válida." }, { status: 400 });
    if (payload.workspace.reports.some((report) => report.signatureDataUrl && report.signatureDataUrl.length > 250_000)) return NextResponse.json({ error: "La firma libre excede el tamaño permitido." }, { status: 413 });
    const record = await ensureMetrologyWorkspace(actor);
    const workspace = prepareMetrologyWorkspace(payload.workspace, isMetrologyWorkspace(record.values) ? record.values : undefined);
    const admin = createAdminClient();
    const updated = await admin.from("form_records").update({ values: workspace }).eq("id", record.id).select("updated_at").single();
    if (updated.error) throw updated.error;
    await admin.from("audit_log").insert({ actor_id: actor.id, action: "metrology.workspace_updated", resource_type: "metrology_workspace", resource_id: record.id, metadata: { asset_count: workspace.assets.length, report_count: workspace.reports.length } });
    return NextResponse.json({ workspace, updatedAt: updated.data.updated_at });
  } catch (error) {
    console.error("No fue posible guardar el expediente de metrología.", error);
    return NextResponse.json({ error: "No fue posible guardar el expediente de metrología." }, { status: 500 });
  }
}
