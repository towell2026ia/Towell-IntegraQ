import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { canPerformModuleAction } from "@/lib/module-permissions";

const headers = { "Cache-Control": "private, no-store" };
async function authorized(write: boolean) {
  const s = await getAuthenticatedSession();
  return s?.authUserId && s.workspaceMode !== "demo" && ["Administrador", "Usuario interno"].includes(s.userType)
    && canPerformModuleAction(s, "corrective-actions", "view") && (!write || canPerformModuleAction(s, "corrective-actions", "update"));
}
const denied = () => NextResponse.json({error:"Seguimiento no autorizado."},{status:403,headers});
export async function GET(request: Request) {
  if (!await authorized(false)) return denied();
  const db = await createClient();
  const actionId = new URL(request.url).searchParams.get("action");
  if (actionId) {
    const result = await db.rpc("iq_u08_redbooth_status",{p_action:actionId});
    return result.error ? NextResponse.json({error:"No se pudo verificar la sincronización."},{status:503,headers})
      : NextResponse.json({records:result.data ?? []},{headers});
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
