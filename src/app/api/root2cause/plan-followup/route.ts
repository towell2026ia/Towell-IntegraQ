import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { canPerformModuleAction } from "@/lib/module-permissions";

import { readConfirmedTaskLinks } from "@/lib/root2cause/redbooth-ledger";

const headers = { "Cache-Control": "private, no-store" };
async function authorized(write: boolean) {
  const s = await getAuthenticatedSession();
  return s?.authUserId && s.workspaceMode !== "demo" && ["Administrador", "Usuario interno"].includes(s.userType)
    && canPerformModuleAction(s, "corrective-actions", "view") && (!write || canPerformModuleAction(s, "corrective-actions", "update")) ? s : null;
}
const denied = () => NextResponse.json({error:"Seguimiento no autorizado."},{status:403,headers});
export async function GET(request: Request) {
  const session = await authorized(false);
  if (!session) return denied();
  const db = await createClient();
  const historyId = new URL(request.url).searchParams.get("history");
  if (historyId) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(historyId)) return denied();
    const scope = await db.rpc("iq_u08_plan_queue");
    if (scope.error) return NextResponse.json({error:"No se pudo verificar el alcance del plan."},{status:503,headers});
    if (!scope.data?.some((p:{plan_id:string})=>p.plan_id===historyId)) return denied();
    const events = await db.from("audit_log").select("created_at,reason").eq("module","corrective-actions")
      .eq("action","root2cause.plan_followup").eq("resource_type","corrective_action_plan")
      .eq("resource_id",historyId).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(100);
    return events.error ? NextResponse.json({error:"Historial no disponible para esta sesión."},{status:503,headers})
      : NextResponse.json({events:events.data ?? []},{headers});
  }
  const actionId = new URL(request.url).searchParams.get("action");
  if (actionId) {
    const result = await db.rpc("iq_u08_redbooth_status",{p_action:actionId});
    if (result.error || !session.organizationId) return NextResponse.json({error:"No se pudo verificar la sincronización."},{status:503,headers});
    try {
      const records = await readConfirmedTaskLinks(session.organizationId,actionId,result.data ?? []);
      return NextResponse.json({records},{headers});
    } catch { return NextResponse.json({error:"No se pudo verificar el vínculo."},{status:503,headers}); }
  }
  const { data, error } = await db.rpc("iq_u08_plan_queue");
  return error ? NextResponse.json({error:"No se pudo consultar el contrato de seguimiento."},{status:503,headers})
    : NextResponse.json({plans:data ?? []},{headers});
}
export async function POST(request: Request) {
  if (!await authorized(true)) return denied();
  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string" || !Number.isInteger(body.revision) || body.revision < 0 ||
    typeof body.note !== "string" || !body.note.trim() || body.note.length > 2000 ||
    !["progress","complete","effective","ineffective","assign"].includes(body.command)) {
    return NextResponse.json({error:"Revisa la operación y la nota."},{status:400,headers});
  }
  const db = await createClient();
  const { data, error } = await db.rpc("iq_u08_update_plan", {
    p_plan:body.id, p_revision:body.revision, p_command:body.command, p_note:body.note,
    p_owner:body.command === "assign" ? body.ownerId ?? null : null,
    p_file:body.command === "complete" ? body.fileId ?? null : null,
  });
  if (error) {
    if (error.code === "42501") return denied();
    const conflict = error.code === "40001";
    const invalid = ["22P02","22023"].includes(error.code);
    return NextResponse.json({error:conflict ? "La revisión cambió. Actualiza y revisa el avance." :
      invalid ? "Verifica el estado, la nota y la evidencia vigente del plan." : "No se pudo confirmar el avance."},
      {status:conflict ? 409 : invalid ? 422 : 503,headers});
  }
  return NextResponse.json({revision:data},{headers});
}
