import { NextResponse } from "next/server";
import { correctiveActionColumns } from "@/lib/corrective-action-query";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function administrator() {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId || !session.organizationId || session.userType !== "Administrador" || session.workspaceMode === "demo") return null;
  const { data, error } = await createAdminClient().from("profiles").select("organization_id,user_type,status,workspace_mode").eq("id", session.authUserId).maybeSingle();
  return !error && data?.status === "active" && data.user_type === "administrator" && data.workspace_mode !== "demo" && data.organization_id === session.organizationId ? session : null;
}
export async function GET() {
  const session = await administrator();
  if (!session) return NextResponse.json({ error: "Consulta exclusiva de administradores activos." }, { status: 403, headers });
  const admin = createAdminClient();
  const actions: Record<string, unknown>[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await admin.from("corrective_actions")
      .select(`${correctiveActionColumns},audit_finding_id,closed_at`)
      .eq("organization_id", session.organizationId).not("deleted_at", "is", null).neq("source", "supplier")
      .order("deleted_at", { ascending: false }).order("id").range(start, start + 499);
    if (error) return NextResponse.json({ error: "No fue posible consultar los registros retirados." }, { status: 500, headers });
    const page = (data ?? []) as Record<string, unknown>[];
    actions.push(...page.filter(row => row.organization_id === session.organizationId && row.deleted_at && row.source !== "supplier"));
    if (page.length < 500) break;
  }
  return NextResponse.json({ actions, recoveryEnabled: process.env.IQ_SGC_RECOVERY_ENABLED === "true" }, { headers });
}
export async function POST(request: Request) {
  const session = await administrator();
  if (!session) return NextResponse.json({ error: "Recuperación exclusiva de administradores activos." }, { status: 403, headers });
  let body: { id?: unknown; reason?: unknown; expectedDeletedAt?: unknown; confirmed?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Solicitud inválida." }, { status: 400, headers }); }
  if (!body || typeof body.id !== "string" || !uuid.test(body.id) || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 2000 ||
    typeof body.expectedDeletedAt !== "string" || !Number.isFinite(Date.parse(body.expectedDeletedAt)) || body.confirmed !== true)
    return NextResponse.json({ error: "Identificador, motivo, fecha de retiro y confirmación obligatorios." }, { status: 400, headers });
  if (process.env.IQ_SGC_RECOVERY_ENABLED !== "true") return NextResponse.json({ error: "Recuperación pendiente de autorización y validación aislada." }, { status: 503, headers });
  const client = createAdminClient();
  const { data, error } = await client.rpc("iq_sgc_restore_corrective_action", { requested_actor: session.authUserId, requested_id: body.id, expected_deleted_at: body.expectedDeletedAt, requested_reason: body.reason.trim(), requested_confirmation: true });
  if (error) return NextResponse.json({ error: "No se recuperó el registro. Recarga y verifica permisos, retiro vigente y autorización." }, { status: 409, headers });
  return NextResponse.json({ receipt: data }, { headers });
}
