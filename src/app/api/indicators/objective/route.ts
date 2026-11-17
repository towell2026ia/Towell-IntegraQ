import { NextResponse } from "next/server";
import { validQualityObjective } from "@/lib/indicators/quality-objectives";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { isExternalUser } from "@/lib/session-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

export async function PUT(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
  if (isExternalUser(session) || !canPerformModuleAction(session, "indicators", "update")) return NextResponse.json({ error: "No tienes permiso para editar objetivos de indicadores." }, { status: 403 });
  const body = await request.json().catch(() => null) as { indicatorId?: unknown; expectedUpdatedAt?: unknown; objective?: unknown } | null;
  if (typeof body?.indicatorId !== "string" || !/^IND-\d+$/.test(body.indicatorId)
    || typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))
    || !validQualityObjective(body.objective)) return NextResponse.json({ error: "Selecciona un objetivo válido y recarga el indicador antes de guardar." }, { status: 400 });
  const supabase = await createClient();
  const result = await supabase.rpc("iq_indicator_set_quality_objective", {
    p_code: body.indicatorId, p_expected_updated_at: body.expectedUpdatedAt, p_objective: body.objective,
  });
  if (result.error) {
    if (["PGRST202", "42883"].includes(result.error.code)) return NextResponse.json({ error: "La edición de objetivos aún no está activada en la base de datos." }, { status: 503 });
    if (result.error.message.includes("INDICATOR_OBJECTIVE_CONFLICT")) return NextResponse.json({ error: "El indicador cambió. Recarga la página antes de guardar." }, { status: 409 });
    if (result.error.code === "42501") return NextResponse.json({ error: "No tienes permiso para modificar este indicador o proceso." }, { status: 403 });
    return NextResponse.json({ error: "No se guardó el objetivo. Consulta el indicador antes de reintentar." }, { status: 400 });
  }
  return NextResponse.json({ indicatorId: body.indicatorId, objective: body.objective, updatedAt: result.data }, { headers: { "Cache-Control": "private, no-store" } });
}
