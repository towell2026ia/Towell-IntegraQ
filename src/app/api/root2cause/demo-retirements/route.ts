import { NextResponse } from "next/server";

import { demoCorrectiveActions } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";

const area = "root2causeDemoRetirements";
type Retirement = { id: string; folio: string; deletedAt: string; deletedBy: string; reason: string };

async function actorScope() {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return null;
  const profile = await supabase.from("profiles").select("organization_id,user_type,status,workspace_mode")
    .eq("id", user.data.user.id).maybeSingle();
  if (profile.error || !profile.data || profile.data.status !== "active" ||
    !["administrator", "internal"].includes(profile.data.user_type) || !profile.data.organization_id ||
    profile.data.workspace_mode === "demo") return null;
  return { supabase, id: user.data.user.id, organizationId: profile.data.organization_id,
    administrator: profile.data.user_type === "administrator" };
}

function retirementsFrom(value: unknown): Retirement[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { retirements?: unknown }).retirements)) return [];
  return (value as { retirements: Retirement[] }).retirements;
}

export async function GET() {
  const actor = await actorScope();
  if (!actor) return NextResponse.json({ error: "Acceso interno requerido." }, { status: 403 });
  const result = await actor.supabase.from("workspace_data").select("payload")
    .eq("workspace_id", actor.organizationId).eq("workspace_mode", "production").eq("area", area)
    .is("deleted_at", null).maybeSingle();
  if (result.error) return NextResponse.json({ error: "No fue posible consultar los retiros de Root2Cause." }, { status: 500 });
  return NextResponse.json({ retirements: retirementsFrom(result.data?.payload) });
}

export async function DELETE(request: Request) {
  const actor = await actorScope();
  if (!actor?.administrator) return NextResponse.json({ error: "Sólo un administrador activo puede retirar ejemplos." }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown; reason?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const sample = demoCorrectiveActions.find((action) => action.id === id);
  if (!sample || !reason || reason.length > 1000) return NextResponse.json({ error: "Ejemplo válido y motivo obligatorio." }, { status: 400 });

  const current = await actor.supabase.from("workspace_data").select("id,payload,revision")
    .eq("workspace_id", actor.organizationId).eq("workspace_mode", "production").eq("area", area)
    .is("deleted_at", null).maybeSingle();
  if (current.error) return NextResponse.json({ error: "No fue posible consultar el historial antes de retirar el ejemplo." }, { status: 500 });
  const previous = retirementsFrom(current.data?.payload);
  if (previous.some((item) => item.id === id)) return NextResponse.json({ error: "El ejemplo ya fue retirado." }, { status: 409 });
  const entry: Retirement = { id, folio: sample.folio, deletedAt: new Date().toISOString(), deletedBy: actor.id, reason };
  const payload = { retirements: [...previous, entry] };
  const saved = current.data
    ? await actor.supabase.from("workspace_data").update({ payload, updated_by: actor.id })
      .eq("id", current.data.id).eq("revision", current.data.revision).select("id").maybeSingle()
    : await actor.supabase.from("workspace_data").insert({ workspace_id: actor.organizationId,
      workspace_mode: "production", area, payload, created_by: actor.id, updated_by: actor.id }).select("id").maybeSingle();
  if (saved.error) return NextResponse.json({ error: "No fue posible guardar el retiro administrativo." }, { status: 500 });
  if (!saved.data) return NextResponse.json({ error: "El historial cambió. Recarga y vuelve a intentar." }, { status: 409 });
  return NextResponse.json({ ok: true, retirement: entry });
}
