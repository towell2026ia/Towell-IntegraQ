import { NextResponse } from "next/server";
import { loadMatrixReports, paginatedRows, readRncpSettings, rncpContext, RncpError } from "@/lib/rncp/server";
import { validateAlertRules } from "@/lib/rncp/alerts";
import { configuredSemanticProvider } from "@/lib/rncp/semantic-provider";
import { verifyAlertReview } from "@/lib/rncp/review-signature";

export async function GET(request: Request) {
  try {
    const context = await rncpContext("view", true);
    const params = new URL(request.url).searchParams;
    if (params.get("catalog") === "suppliers") {
      if (context.profile.user_type !== "administrator") throw new RncpError("Conciliación exclusiva de administración.", 403);
      const suppliers = await paginatedRows<{ id: string; code: string; name: string; active: boolean }>((from, to) => context.admin.from("organizations").select("id,code,name,active", { count: "exact" }).eq("kind", "supplier").or(`owning_organization_id.is.null,owning_organization_id.eq.${context.organizationId}`).order("id").range(from, to));
      return NextResponse.json({ suppliers }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const id = params.get("reportId");
    if (!id) throw new RncpError("Selecciona un expediente.");
    const reports = await loadMatrixReports(context, id);
    type Action = { id: string; description: string; root_cause: string | null; action_plan: string | null; containment: string | null; commitments: string | null; status: string; created_at: string; validated_at: string | null; validation_comment: string | null };
    const actions = await paginatedRows<Action>((from, to) => context.admin.from("supplier_rncp_actions").select("id,description,root_cause,action_plan,containment,commitments,status,created_at,validated_at,validation_comment", { count: "exact" }).eq("report_id", id).order("id").range(from, to));
    const evidence: Array<{ id: string; resource_id: string; original_name: string; mime_type: string; size_bytes: number; created_at: string }> = [];
    for (let offset = 0; offset < actions.length; offset += 100) {
      const batch = actions.slice(offset, offset + 100).map(action => action.id);
      const links = await paginatedRows<{ id: string; file_id: string }>((from, to) => context.admin.from("supplier_rncp_action_evidence").select("id,file_id", { count: "exact" }).in("action_id", batch).order("id").range(from, to));
      for (let index = 0; index < links.length; index += 100) evidence.push(...await paginatedRows<(typeof evidence)[number]>((from, to) => context.admin.from("file_objects").select("id,resource_id,original_name,mime_type,size_bytes,created_at", { count: "exact" }).in("id", links.slice(index, index + 100).map(link => link.file_id)).in("resource_id", batch).eq("resource_type", "supplier_rncp_action_evidence").is("deleted_at", null).order("id").range(from, to)));
    }
    const [notifications, history] = await Promise.all([
      context.admin.from("supplier_rncp_notification_outbox").select("id,event_type,occurrence,recipient_kind,delivery_state,attempts,sent_at,last_error_code,created_at").eq("report_id", id).order("created_at", { ascending: false }),
      context.admin.from("audit_log").select("id,action,reason,created_at,user_name_snapshot,metadata").eq("resource_type", "supplier_rncp_report").eq("resource_id", id).order("created_at", { ascending: false }),
    ]);
    if (notifications.error || history.error) throw new RncpError("No se pudo consultar la trazabilidad completa.", 503);
    return NextResponse.json({ originalFiles: reports[0].originalFiles, actions: actions.map(action => ({ ...action, evidence: evidence.filter(file => file.resource_id === action.id) })), notifications: notifications.data, history: history.data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.command !== "string") throw new RncpError("Operación RNCP inválida.");
    const command = body.command;
    const context = await rncpContext(["config", "review_alert", "evaluate"].includes(command) ? "admin" : "update", ["save_response", "submit_delivery"].includes(command));
    if (command === "config") {
      const current = await readRncpSettings(context);
      if (body.emailEnabled) throw new RncpError("La activación de correos reales requiere autorización independiente.", 403);
      const semanticAiApproved = body.semanticAiApproved === true;
      if (semanticAiApproved && (!configuredSemanticProvider() || body.consent !== "MINIMIZED_DEFECT_TEXT_ONLY")) throw new RncpError("Falta proveedor IA configurado y consentimiento administrativo para descripciones minimizadas.", 409);
      const result = await context.supabase.rpc("iq_rncp_save_workspace", { p_area: "rncpFollowupSettings", p_expected_revision: body.expectedRevision,
        p_payload: { ...current.settings, alertRules: validateAlertRules((body.alertRules ?? current.settings.alertRules) as Parameters<typeof validateAlertRules>[0]),
          semanticAiApproved, followupEnabled: body.followupEnabled === true, emailEnabled: false,
          reviewedBy: context.profile.id, reviewedAt: new Date().toISOString() } });
      if (result.error) throw new RncpError("La configuración cambió o no pudo guardarse. Recarga antes de reintentar.", 409);
      return NextResponse.json(result.data);
    }
    if (command === "review_alert") {
      const key = String(body.key ?? ""), token = String(body.token ?? ""), reason = String(body.reason ?? "").trim();
      if (key.length > 50000 || !verifyAlertReview(context.organizationId, key, token) || !["confirmed", "dismissed"].includes(String(body.decision)) || reason.length < 3) throw new RncpError("La alerta, la decisión o el motivo no son válidos.", 403);
      const configuration = await readRncpSettings(context);
      const result = await context.supabase.rpc("iq_rncp_save_workspace", { p_area: "rncpAlertReviews", p_expected_revision: body.expectedRevision,
        p_payload: { ...configuration.reviews, [key]: { decision: body.decision, reason, actorId: context.profile.id, reviewedAt: new Date().toISOString() } } });
      if (result.error) throw new RncpError("Las revisiones cambiaron. Actualiza el dashboard y reintenta.", 409);
      return NextResponse.json(result.data);
    }
    if (command === "evaluate") {
      const config = await readRncpSettings(context);
      if (!config.settings.followupEnabled) return NextResponse.json({ queued: 0, emailsSent: 0, state: "disabled" });
      const result = await context.admin.rpc("iq_rncp_queue_notifications", { p_organization_id: context.organizationId });
      if (result.error) throw new RncpError("No se pudo preparar el seguimiento.", 503);
      return NextResponse.json({ queued: result.data, emailsSent: 0, state: "real_email_disabled" });
    }
    const reportId = typeof body.reportId === "string" ? body.reportId : "";
    if (!/^[a-f0-9-]{36}$/i.test(reportId)) throw new RncpError("Identificador de RNCP inválido.");
    await loadMatrixReports(context, reportId);
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    if (command === "save_response") {
      if (!context.supplier) throw new RncpError("El avance debe registrarse con la identidad del proveedor autorizado.", 403);
      const result = await context.supabase.rpc("iq_rncp_save_response", { p_action_id: body.actionId ?? null, p_report_id: reportId, p_payload: payload });
      if (result.error) throw new RncpError("El avance no se guardó: verifica expediente, campos y permisos.", 409);
      return NextResponse.json({ actionId: result.data });
    }
    if (!["record_notification", "submit_delivery", "approve", "reject", "reconcile"].includes(command)) throw new RncpError("Operación RNCP no permitida.");
    const result = await context.supabase.rpc("iq_rncp_followup_command", { p_report_id: reportId, p_command: command, p_payload: payload });
    if (result.error) {
      const msg = result.error.message;
      throw new RncpError(msg.includes("REQUIREMENTS_INCOMPLETE") ? "Faltan requisitos o evidencias válidas. La entrega no pasó a validación."
        : msg.includes("IMMUTABLE") ? "La notificación original y su vencimiento no pueden reiniciarse."
        : msg.includes("INSPECTOR") ? "Sólo inspectormp puede validar y cerrar una entrega completa."
        : msg.includes("HISTORICAL") ? "Los registros importados conservan su estado histórico; no se les aplica un temporizador nuevo."
        : "La operación no se completó. Verifica permisos, estado y datos obligatorios.", msg.includes("FORBIDDEN") || msg.includes("INSPECTOR") ? 403 : 409);
    }
    return NextResponse.json(result.data);
  } catch (error) { return failure(error); }
}
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible completar la operación RNCP." }, { status: error instanceof RncpError ? error.status : 500 }); }
