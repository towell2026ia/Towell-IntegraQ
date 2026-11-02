import { NextResponse } from "next/server";

import { authorize } from "@/lib/access/authorize";
import { processCatalog } from "@/lib/configuration-data";
import { buildEmptyRiskWorkspace, softDeleteRiskWorkspaceItem, validateRiskWorkspaceEdit, type RiskWorkspaceDeleteKind, type RiskWorkspaceState } from "@/lib/risk-opportunity-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const registrationNumber = "SYS-RYO-WORKSPACE-2025";
const recordNumber = "RYO-WORKSPACE-2025";
const masterProcessIds = processCatalog.filter((process) => process.level === "process").map((process) => process.id);

type Actor = { id: string; userType: "administrator" | "internal" };

async function requireInternalActor(): Promise<Actor | null> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data: profile } = await supabase.from("profiles").select("user_type,status").eq("id", userData.user.id).maybeSingle();
  if (!profile || profile.status !== "active" || !["administrator", "internal"].includes(profile.user_type)) return null;
  return { id: userData.user.id, userType: profile.user_type as Actor["userType"] };
}

async function ensureWorkspace(actor: Actor, createIfMissing = false) {
  const admin = createAdminClient();
  const definitionResult = await admin.from("form_definitions").select("id").eq("registration_number", registrationNumber).maybeSingle();
  if (definitionResult.error) throw definitionResult.error;
  let definition = definitionResult.data;
  if (!definition) {
    if (!createIfMissing || actor.userType !== "administrator") return null;
    const created = await admin.from("form_definitions").insert({ registration_number: registrationNumber, name: "Matriz base de Dirección · Riesgos y oportunidades 2025", process_id: "P-03", version: 1, status: "active", source_type: "excel", created_by: actor.id }).select("id").single();
    if (created.error) throw created.error;
    definition = created.data;
  }
  const recordResult = await admin.from("form_records").select("id,values,updated_at")
    .eq("form_id", definition.id).eq("record_number", recordNumber).maybeSingle();
  if (recordResult.error) throw recordResult.error;
  let record = recordResult.data;
  if (!record) {
    if (!createIfMissing || actor.userType !== "administrator") return null;
    const created = await admin.from("form_records").insert({ form_id: definition.id, record_number: recordNumber, status: "active", values: buildEmptyRiskWorkspace(), created_by: actor.id }).select("id,values,updated_at").single();
    if (created.error) throw created.error;
    record = created.data;
  }
  return record;
}

function isWorkspaceState(value: unknown): value is RiskWorkspaceState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<RiskWorkspaceState>;
  return Number.isInteger(state.cycle) && Array.isArray(state.axes) && Array.isArray(state.directionCandidates) && Array.isArray(state.risks) && Array.isArray(state.swotItems) && Array.isArray(state.actions) && Array.isArray(state.contributions);
}

export async function GET() {
  try {
    const actor = await requireInternalActor();
    if (!actor) return NextResponse.json({ error: "Acceso interno requerido." }, { status: 403 });
    const session = await getAuthenticatedSession();
    const representativeProcessId = session?.assignedProcessIds[0];
    const access = authorize({ user: session, permission: "risks.read", record: { processId: representativeProcessId } });
    if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: 403 });
    const record = await ensureWorkspace(actor);
    if (!record) return NextResponse.json({ state: buildEmptyRiskWorkspace(), updatedAt: null, storage: "supabase" });
    return NextResponse.json({ state: record.values, updatedAt: record.updated_at, storage: "supabase" });
  } catch (error) {
    console.error("No fue posible consultar la matriz base de riesgos.", error);
    return NextResponse.json({ error: "No fue posible consultar la matriz base en Supabase." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireInternalActor();
    if (!actor) return NextResponse.json({ error: "Acceso interno requerido." }, { status: 403 });
    const session = await getAuthenticatedSession();
    const representativeProcessId = session?.assignedProcessIds[0];
    const access = authorize({ user: session, permission: "risks.edit", record: { processId: representativeProcessId } });
    if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: 403 });
    const payload = await request.json() as { state?: unknown };
    if (!isWorkspaceState(payload.state)) return NextResponse.json({ error: "La matriz enviada no tiene una estructura válida." }, { status: 400 });
    const record = await ensureWorkspace(actor, true);
    if (!record) return NextResponse.json({ error: "No fue posible inicializar la matriz." }, { status: 500 });
    if (!isWorkspaceState(record.values)) return NextResponse.json({ error: "La matriz base no está disponible." }, { status: 500 });
    const invalidEdit = validateRiskWorkspaceEdit(record.values, payload.state);
    if (invalidEdit) return NextResponse.json({ error: invalidEdit }, { status: 409 });
    const admin = createAdminClient();
    let nextState = payload.state;
    if (actor.userType !== "administrator") {
      if (!isWorkspaceState(record.values)) return NextResponse.json({ error: "La matriz base no está disponible." }, { status: 500 });
      const permissions = await admin.from("user_process_permissions").select("process_id").eq("user_id", actor.id);
      if (permissions.error) throw permissions.error;
      const allowed = new Set((permissions.data ?? []).map((permission) => permission.process_id));
      nextState = mergeScopedWorkspace(record.values, payload.state, allowed);
    }
    const invalidMergedEdit = validateRiskWorkspaceEdit(record.values, nextState);
    if (invalidMergedEdit) return NextResponse.json({ error: invalidMergedEdit }, { status: 409 });
    const updated = await admin.from("form_records").update({ values: nextState }).eq("id", record.id)
      .eq("updated_at", record.updated_at).select("updated_at").maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return NextResponse.json({ error: "La matriz cambió. Recarga y vuelve a intentar." }, { status: 409 });
    await admin.from("audit_log").insert({ actor_id: actor.id, action: "risk.workspace_updated", resource_type: "risk_workspace", resource_id: record.id, metadata: { cycle: nextState.cycle, candidate_count: nextState.directionCandidates.length, risk_count: nextState.risks.length } });
    return NextResponse.json({ ok: true, updatedAt: updated.data.updated_at });
  } catch (error) {
    console.error("No fue posible guardar la matriz base de riesgos.", error);
    return NextResponse.json({ error: "No fue posible guardar la matriz base en Supabase." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireInternalActor();
    if (!actor || actor.userType !== "administrator") return NextResponse.json({ error: "Sólo un administrador activo puede retirar riesgos." }, { status: 403 });
    const session = await getAuthenticatedSession();
    if (!session || session.authUserId !== actor.id || session.userType !== "Administrador" || session.workspaceMode === "demo") {
      return NextResponse.json({ error: "Sesión administrativa productiva requerida." }, { status: 403 });
    }
    const payload = await request.json() as { kind?: unknown; id?: unknown; reason?: unknown };
    const kind = payload.kind === undefined ? "risk" : payload.kind;
    if (kind !== "risk" && kind !== "axis" && kind !== "directionCandidate") {
      return NextResponse.json({ error: "Tipo de registro inválido." }, { status: 400 });
    }
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    if (!id || !reason || reason.length > 1000) return NextResponse.json({ error: "Folio y motivo obligatorios." }, { status: 400 });
    const admin = createAdminClient();
    const [profile, process] = await Promise.all([
      admin.from("profiles").select("organization_id,user_type,status,workspace_mode").eq("id", actor.id).maybeSingle(),
      admin.from("processes").select("organization_id").eq("id", "P-03").maybeSingle(),
    ]);
    if (profile.error || process.error || !profile.data?.organization_id ||
      profile.data.user_type !== "administrator" || profile.data.status !== "active" ||
      profile.data.workspace_mode === "demo" || process.data?.organization_id !== profile.data.organization_id) {
      return NextResponse.json({ error: "El expediente no pertenece a la organización administrativa." }, { status: 403 });
    }
    const record = await ensureWorkspace(actor);
    if (!record || !isWorkspaceState(record.values)) return NextResponse.json({ error: "La matriz no está disponible." }, { status: 404 });
    const item = kind === "risk" ? record.values.risks.find((entry) => entry.id === id && !entry.deletedAt)
      : kind === "axis" ? record.values.axes.find((entry) => entry.id === id && !entry.deletedAt)
        : record.values.directionCandidates.find((entry) => entry.id === id && !entry.deletedAt);
    if (!item) return NextResponse.json({ error: "El registro no existe o ya fue retirado." }, { status: 404 });
    if (kind === "risk") {
      const risk = item as RiskWorkspaceState["risks"][number];
      const processScope = await admin.from("processes").select("organization_id").eq("id", risk.processId).maybeSingle();
      if (processScope.error || processScope.data?.organization_id !== profile.data.organization_id) {
        return NextResponse.json({ error: "El proceso del riesgo está fuera de la organización." }, { status: 403 });
      }
    }
    let state: RiskWorkspaceState;
    try { state = softDeleteRiskWorkspaceItem(record.values, kind as RiskWorkspaceDeleteKind, id, actor.id, reason, new Date().toISOString()); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "El registro tiene relaciones vigentes." }, { status: 409 }); }
    const changed = await admin.from("form_records").update({ values: state }).eq("id", record.id)
      .eq("updated_at", record.updated_at).select("id").maybeSingle();
    if (changed.error) throw changed.error;
    if (!changed.data) return NextResponse.json({ error: "La matriz cambió. Recarga y vuelve a intentar." }, { status: 409 });
    const logged = await admin.from("audit_log").insert({ actor_id: actor.id,
      organization_id: profile.data.organization_id, action: "risk_workspace_item.soft_deleted", resource_type: kind,
      resource_id: id, reason, metadata: { title: "title" in item ? item.title : "description" in item ? item.description : id,
        process_id: "processId" in item ? item.processId : null,
        preserved_actions: record.values.actions.filter((item) => item.riskId === id).length } });
    return NextResponse.json({ ok: true, state, auditLogged: !logged.error });
  } catch (error) {
    console.error("No fue posible retirar el riesgo.", error);
    return NextResponse.json({ error: "No fue posible retirar el riesgo en Supabase." }, { status: 500 });
  }
}

function mergeScopedWorkspace(current: RiskWorkspaceState, incoming: RiskWorkspaceState, allowed: Set<string>): RiskWorkspaceState {
  const merge = <T extends { id: string }>(existing: T[], proposed: T[], canEdit: (item: T) => boolean) => [
    ...existing.filter((item) => !canEdit(item)),
    ...proposed.filter(canEdit),
  ];
  const riskEditable = (risk: RiskWorkspaceState["risks"][number]) => allowed.has(risk.processId);
  const editableRiskIds = new Set([...current.risks, ...incoming.risks].filter(riskEditable).map((risk) => risk.id));
  return {
    ...current,
    swotItems: merge(current.swotItems, incoming.swotItems, (item) => allowed.has(item.processId)),
    risks: merge(current.risks, incoming.risks, riskEditable),
    actions: merge(current.actions, incoming.actions, (item) => editableRiskIds.has(item.riskId)),
    contributions: merge(current.contributions, incoming.contributions, (item) => allowed.has(item.sourceProcessId) || allowed.has(item.targetProcessId)),
  };
}

export async function POST(request: Request) {
  try {
    const actor = await requireInternalActor();
    if (!actor || actor.userType !== "administrator") return NextResponse.json({ error: "Solo Dirección o un administrador puede iniciar el análisis." }, { status: 403 });
    const access = authorize({ user: await getAuthenticatedSession(), permission: "risks.approve" });
    if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: 403 });
    const payload = await request.json() as { action?: string };
    if (payload.action !== "start_analysis") return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
    const record = await ensureWorkspace(actor, true);
    if (!record || !isWorkspaceState(record.values)) return NextResponse.json({ error: "La matriz base no está disponible." }, { status: 500 });
    const admin = createAdminClient();
    const state: RiskWorkspaceState = { ...record.values, cycleStatus: "active" };
    const saved = await admin.from("form_records").update({ values: state }).eq("id", record.id);
    if (saved.error) throw saved.error;

    const [permissionsResult, profilesResult, existingResult] = await Promise.all([
      admin.from("user_process_permissions").select("user_id,process_id").in("process_id", masterProcessIds),
      admin.from("profiles").select("id,user_type,status").eq("status", "active").in("user_type", ["administrator", "internal"]),
      admin.from("notifications").select("recipient_id").eq("resource_type", "risk_cycle_start").eq("resource_id", record.id),
    ]);
    const firstError = permissionsResult.error ?? profilesResult.error ?? existingResult.error;
    if (firstError) throw firstError;
    const activeUsers = new Set((profilesResult.data ?? []).map((profile) => profile.id));
    const administrators = (profilesResult.data ?? []).filter((profile) => profile.user_type === "administrator").map((profile) => profile.id);
    const recipientsByProcess = new Map<string, string[]>();
    for (const permission of permissionsResult.data ?? []) {
      if (!activeUsers.has(permission.user_id)) continue;
      recipientsByProcess.set(permission.process_id, [...(recipientsByProcess.get(permission.process_id) ?? []), permission.user_id]);
    }
    const uncoveredProcessIds = masterProcessIds.filter((processId) => !(recipientsByProcess.get(processId)?.length));
    const recipientIds = new Set<string>();
    for (const processId of masterProcessIds) for (const userId of recipientsByProcess.get(processId) ?? administrators) recipientIds.add(userId);
    const existingRecipients = new Set((existingResult.data ?? []).map((notification) => notification.recipient_id));
    const notifications = [...recipientIds].filter((id) => !existingRecipients.has(id)).map((recipientId) => ({ recipient_id: recipientId, title: `Iniciar análisis ${state.cycle}`, message: "Dirección activó la matriz base. Inicia el FODA, el FODA cruzado, la matriz de riesgos y oportunidades y la matriz de operaciones de tus procesos asignados.", module_id: "risks", resource_type: "risk_cycle_start", resource_id: record.id, action_url: "/#risks" }));
    if (notifications.length) {
      const inserted = await admin.from("notifications").insert(notifications);
      if (inserted.error) throw inserted.error;
    }
    await admin.from("audit_log").insert({ actor_id: actor.id, action: "risk.analysis_started", resource_type: "risk_workspace", resource_id: record.id, metadata: { cycle: state.cycle, process_count: masterProcessIds.length, notified_users: notifications.length, uncovered_process_ids: uncoveredProcessIds } });
    return NextResponse.json({ ok: true, state, notifiedUsers: notifications.length, processCount: masterProcessIds.length, uncoveredProcessIds });
  } catch (error) {
    console.error("No fue posible iniciar el análisis de procesos.", error);
    return NextResponse.json({ error: "No fue posible activar el análisis ni enviar las notificaciones." }, { status: 500 });
  }
}
