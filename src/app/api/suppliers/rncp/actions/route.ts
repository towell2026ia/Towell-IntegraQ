import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload.reportId !== "string") return NextResponse.json({ error: "Solicitud de acción no válida." }, { status: 400 });
  const supabase = await createClient();
  const result = await supabase.rpc("save_supplier_rncp_action", {
    requested_action_id: typeof payload.actionId === "string" ? payload.actionId : null,
    requested_report_id: payload.reportId,
    requested_description: typeof payload.description === "string" ? payload.description : "",
    requested_responsible_name: typeof payload.responsibleName === "string" ? payload.responsibleName : "",
    requested_due_date: typeof payload.dueDate === "string" && payload.dueDate ? payload.dueDate : null,
    requested_executed_at: typeof payload.executedAt === "string" && payload.executedAt ? payload.executedAt : null,
    requested_comment: typeof payload.comment === "string" ? payload.comment : "",
    requested_status: payload.status,
  });
  if (result.error) return actionError(result.error.message);
  return NextResponse.json({ action: mutationIdentity(result.data) });
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload.actionId !== "string") return NextResponse.json({ error: "Solicitud de revisión no válida." }, { status: 400 });
  const supabase = await createClient();
  const result = await supabase.rpc("review_supplier_rncp_action", {
    requested_action_id: payload.actionId,
    requested_decision: payload.decision,
    requested_comment: typeof payload.comment === "string" ? payload.comment : "",
  });
  if (result.error) return actionError(result.error.message);
  return NextResponse.json({ action: mutationIdentity(result.data) });
}

function mutationIdentity(value: unknown) {
  const record = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
  return { id: String(record?.id ?? ""), reportId: String(record?.report_id ?? ""), status: String(record?.status ?? "pending") };
}

function actionError(message: string) {
  const errors: Record<string, string> = {
    RNCP_ACTION_FORBIDDEN: "No tienes acceso para responder esta RNCP.",
    RNCP_ACTION_REQUIRED_FIELDS: "Completa descripción, responsable y fecha compromiso.",
    RNCP_ACTION_STATUS_INVALID: "El estado seleccionado no está permitido.",
    RNCP_ACTION_EDIT_FORBIDDEN: "Esta acción ya no puede modificarse.",
    RNCP_REVIEW_FORBIDDEN: "No tienes permiso para revisar acciones del proveedor.",
    RNCP_REVIEW_INVALID: "La decisión solicitada no es válida.",
    RNCP_REJECTION_COMMENT_REQUIRED: "Indica el motivo del rechazo.",
    RNCP_REVIEW_NOT_AVAILABLE: "La acción no está disponible para revisión.",
    RNCP_ACTIONS_LOCKED: "La RNCP está cerrada o eliminada.",
  };
  const key = Object.keys(errors).find((candidate) => message.includes(candidate));
  return NextResponse.json({ error: key ? errors[key] : "No fue posible actualizar la acción." }, { status: message.includes("FORBIDDEN") ? 403 : 400 });
}
