import { NextResponse } from "next/server";

import { canAccessModule } from "@/lib/access-policy";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActiveSession } from "@/lib/session-data";
import type { CorrectiveAction } from "@/lib/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set(["open", "analysis", "action_plan", "implementation", "effectiveness", "closed"]);
const severities = new Set(["low", "medium", "high", "critical"]);

async function internalScope(session: ActiveSession | null): Promise<{ organizationId: string; administrator: boolean } | null> {
  if (!session?.authUserId || !["Administrador", "Usuario interno"].includes(session.userType) || session.workspaceMode === "demo") return null;
  const profile = await createAdminClient().from("profiles")
    .select("organization_id,user_type,status,workspace_mode").eq("id", session.authUserId).maybeSingle();
  const persistedRole = session.userType === "Administrador" ? "administrator" : "internal";
  if (profile.error || profile.data?.user_type !== persistedRole || profile.data?.status !== "active" ||
      profile.data.workspace_mode === "demo" || !profile.data.organization_id) return null;
  return { organizationId: profile.data.organization_id, administrator: profile.data.user_type === "administrator" };
}

async function administratorScope(session: ActiveSession | null): Promise<string | null> {
  if (session?.userType !== "Administrador") return null;
  const scope = await internalScope(session);
  return scope?.administrator ? scope.organizationId : null;
}

function validAction(value: unknown): value is CorrectiveAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<CorrectiveAction>;
  return Boolean(
    typeof action.id === "string" && uuid.test(action.id) &&
    (action.source !== "customer" || (typeof action.relatedPartyId === "string" && uuid.test(action.relatedPartyId))) &&
    (!action.qualityCaseId || uuid.test(action.qualityCaseId)) &&
    ["internal", "audit", "customer", "sgc"].includes(action.source ?? "") && /^AC-\d{4}-\d{3,}$/.test(action.folio ?? "") &&
    typeof action.title === "string" && action.title.trim() &&
    typeof action.problem === "string" && action.problem.trim() &&
    typeof action.owner === "string" && action.owner.trim() &&
    typeof action.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(action.dueDate) &&
    statuses.has(action.status ?? "") && severities.has(action.severity ?? "") &&
    typeof action.progress === "number" && action.progress >= 0 && action.progress <= 100 &&
    action.a3 && Array.isArray(action.a3.plans) &&
    action.a3.plans.every(plan => uuid.test(plan.id) && plan.description.trim() && plan.owner.trim() && /^\d{4}-\d{2}-\d{2}$/.test(plan.dueDate))
  );
}

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session || session.userType !== "Cliente" || session.externalParty?.kind !== "customer" ||
      !uuid.test(session.externalParty.companyId) || !canAccessModule(session, "customer-portal")) {
    return NextResponse.json({ error: "Acceso de cliente no autorizado." }, { status: 403 });
  }
  const supabase = await createClient();
  const result = await supabase.from("corrective_actions")
    .select("id,folio,title,source,status,progress,due_date,external_organization_id,portal_visible,deleted_at")
    .eq("source", "customer")
    .eq("external_organization_id", session.externalParty.companyId)
    .eq("portal_visible", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (result.error) return NextResponse.json({ error: "No fue posible consultar las acciones autorizadas." }, { status: 500 });
  return NextResponse.json({ actions: (result.data ?? [])
    .filter(row => row.source === "customer" && row.portal_visible === true && !row.deleted_at &&
      row.external_organization_id === session.externalParty!.companyId)
    .map(row => ({
    id: row.id, folio: row.folio, title: row.title,
    status: row.status, progress: row.progress, dueDate: row.due_date,
  })) });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  const scope = await internalScope(session);
  if (!scope || !session) return NextResponse.json({ error: "Acceso interno no autorizado." }, { status: 403 });
  const { organizationId } = scope;
  const body = await request.json() as { action?: unknown; publish?: boolean };
  if (!validAction(body.action)) return NextResponse.json({ error: "El análisis está incompleto o no tiene un cliente real." }, { status: 400 });
  if (body.publish && (!scope.administrator || body.action.source !== "customer")) {
    return NextResponse.json({ error: "Sólo un administrador puede publicar análisis externos." }, { status: 403 });
  }
  const action = body.action;
  const admin = createAdminClient();
  let companyId: string | null = null;
  if (action.source === "customer") {
    const company = await admin.from("organizations").select("id").eq("id", action.relatedPartyId!).eq("kind", "customer").eq("active", true).maybeSingle();
    if (company.error || !company.data) return NextResponse.json({ error: "El cliente seleccionado no está activo en el catálogo real." }, { status: 400 });
    companyId = company.data.id;
    if (action.qualityCaseId) {
      const claim = await admin.from("quality_cases").select("id").eq("id", action.qualityCaseId).eq("external_organization_id", companyId).maybeSingle();
      if (claim.error || !claim.data) return NextResponse.json({ error: "La reclamación no pertenece al cliente seleccionado." }, { status: 400 });
    }
  }
  const current = await admin.from("corrective_actions")
    .select("id,source,external_organization_id,organization_id,created_by,deleted_at")
    .eq("id", action.id).maybeSingle();
  if (current.error) return NextResponse.json({ error: "No fue posible comprobar el análisis existente." }, { status: 500 });
  if (current.data && (current.data.deleted_at || current.data.source !== action.source || current.data.external_organization_id !== companyId || current.data.organization_id !== organizationId)) {
    return NextResponse.json({ error: "El análisis existente no corresponde al origen, cliente u organización." }, { status: 409 });
  }
  if (current.data && (!canPerformModuleAction(session, "corrective-actions", "update") || (!scope.administrator && current.data.created_by !== session.authUserId))) {
    return NextResponse.json({ error: "No tienes permiso para actualizar este análisis." }, { status: 403 });
  }
  if (!current.data && !canPerformModuleAction(session, "corrective-actions", "create")) {
    return NextResponse.json({ error: "No tienes permiso para crear análisis." }, { status: 403 });
  }
  if (action.a3!.plans.length) {
    const existingPlans = await admin.from("corrective_action_plans").select("id,corrective_action_id")
      .in("id", action.a3!.plans.map(plan => plan.id));
    if (existingPlans.error || (existingPlans.data ?? []).some(plan => plan.corrective_action_id !== action.id)) {
      return NextResponse.json({ error: "Un plan pertenece a otro análisis." }, { status: 409 });
    }
  }
  const fields = {
    title: action.title.trim(), problem: action.problem.trim(), severity: action.severity,
    area: action.area || null, owner_name: action.owner.trim(), due_date: action.dueDate,
    status: action.status, progress: action.progress, root_cause: action.rootCause || action.a3!.rootCause || null,
    quality_case_id: action.source === "customer" ? action.qualityCaseId || null : null, portal_visible: false,
  };
  const saved = current.data
    ? await admin.from("corrective_actions").update(fields).eq("id", action.id).eq("organization_id", organizationId).is("deleted_at", null)
    : await admin.from("corrective_actions").insert({ ...fields, id: action.id, folio: action.folio,
        source: action.source, external_organization_id: companyId, organization_id: organizationId, created_by: session.authUserId });
  if (saved.error) return NextResponse.json({ error: "No fue posible guardar el análisis antes de publicarlo." }, { status: 500 });
  const a3 = action.a3!;
  const analysis = await admin.from("corrective_action_a3").upsert({
    corrective_action_id: action.id, event_type: a3.eventType,
    severity_justification: a3.severityJustification, five_w_two_h: a3.fiveW2H,
    brainstorm: a3.brainstorm, ishikawa: a3.ishikawa, non_detection_cause: a3.nonDetectionCause,
    non_detection_whys: a3.nonDetectionWhys, root_cause: a3.rootCause,
    root_cause_whys: a3.rootCauseWhys, ai_draft: action.aiDraft ?? null,
    updated_by: session.authUserId,
  }, { onConflict: "corrective_action_id" });
  if (analysis.error) return NextResponse.json({ error: "Se guardó el expediente sin publicarlo; no fue posible registrar el A3." }, { status: 500 });
  if (a3.plans.length) {
    const plans = await admin.from("corrective_action_plans").upsert(a3.plans.map(plan => ({
      id: plan.id, corrective_action_id: action.id, description: plan.description,
      owner_name: plan.owner, due_date: plan.dueDate, status: plan.status,
    })), { onConflict: "id" });
    if (plans.error) return NextResponse.json({ error: "Se guardó el expediente sin publicarlo; no fue posible registrar los planes." }, { status: 500 });
  }
  if (body.publish) {
    const published = await admin.from("corrective_actions").update({ portal_visible: true }).eq("id", action.id).eq("organization_id", organizationId).is("deleted_at", null).select("id").maybeSingle();
    if (published.error || !published.data) return NextResponse.json({ error: "El expediente se guardó, pero no se autorizó su publicación." }, { status: 500 });
  }
  await admin.from("audit_log").insert({ actor_id: session.authUserId, organization_id: organizationId,
    action: body.publish ? "corrective_action.portal_published" : current.data ? "corrective_action.updated" : "corrective_action.created",
    resource_type: "corrective_action", resource_id: action.id, metadata: { customer_id: companyId } });
  return NextResponse.json({ ok: true, id: action.id, portalVisible: Boolean(body.publish) });
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();
  const organizationId = await administratorScope(session);
  if (!organizationId || !session) return NextResponse.json({ error: "Sólo un administrador puede retirar publicaciones." }, { status: 403 });
  const body = await request.json() as { id?: string };
  if (!body.id || !uuid.test(body.id)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
  const admin = createAdminClient();
  const changed = await admin.from("corrective_actions").update({ portal_visible: false })
    .eq("id", body.id).eq("organization_id", organizationId).eq("source", "customer").is("deleted_at", null).select("id").maybeSingle();
  if (changed.error || !changed.data) return NextResponse.json({ error: "No fue posible retirar la publicación." }, { status: 404 });
  await admin.from("audit_log").insert({ actor_id: session.authUserId, organization_id: organizationId, action: "corrective_action.portal_unpublished",
    resource_type: "corrective_action", resource_id: body.id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await getAuthenticatedSession();
  const organizationId = await administratorScope(session);
  if (!organizationId || !session) return NextResponse.json({ error: "Sólo un administrador puede borrar análisis." }, { status: 403 });
  const body = await request.json() as { id?: string; reason?: string };
  if (!body.id || !uuid.test(body.id) || !body.reason?.trim()) return NextResponse.json({ error: "Identificador y motivo obligatorios." }, { status: 400 });
  const admin = createAdminClient();
  const existing = await admin.from("corrective_actions").select("id,quality_case_id,external_organization_id,deleted_at")
    .eq("id", body.id).eq("organization_id", organizationId).maybeSingle();
  if (existing.error || !existing.data || existing.data.deleted_at) return NextResponse.json({ error: "El análisis no está disponible para borrar." }, { status: 404 });
  const [plans, files] = await Promise.all([
    admin.from("corrective_action_plans").select("id", { count: "exact", head: true }).eq("corrective_action_id", body.id),
    admin.from("file_objects").select("id", { count: "exact", head: true }).eq("resource_id", body.id),
  ]);
  if (plans.error || files.error) return NextResponse.json({ error: "No fue posible comprobar las relaciones del análisis." }, { status: 500 });
  const deleted = await admin.from("corrective_actions").update({ deleted_at: new Date().toISOString(),
    deleted_by: session.authUserId, deletion_reason: body.reason.trim(), portal_visible: false })
    .eq("id", body.id).eq("organization_id", organizationId).is("deleted_at", null).select("id").maybeSingle();
  if (deleted.error || !deleted.data) return NextResponse.json({ error: "No fue posible borrar lógicamente el análisis." }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: session.authUserId, organization_id: organizationId, action: "corrective_action.soft_deleted",
    resource_type: "corrective_action", resource_id: body.id,
    metadata: { reason: body.reason.trim(), quality_case_id: existing.data.quality_case_id,
      customer_id: existing.data.external_organization_id, plans: plans.count ?? 0, files: files.count ?? 0 } });
  return NextResponse.json({ ok: true, preservedPlans: plans.count ?? 0, preservedFiles: files.count ?? 0 });
}
