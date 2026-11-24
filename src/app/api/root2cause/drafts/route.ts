import { NextResponse } from "next/server";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { canAccessProcess, isAdministrator } from "@/lib/session-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
import type { ActiveSession } from "@/lib/session-data";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "private, no-store" };
type Actor = { session: ActiveSession; organizationId: string };
function draftResponse(row: Record<string, unknown>) {
  return { id: row.id, revision: row.revision, currentStep: row.current_step, payload: row.payload,
    processId: row.process_id, source: row.source, updatedAt: row.updated_at };
}

async function actor(): Promise<Actor | NextResponse> {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId || session.workspaceMode === "demo" || !["Administrador", "Usuario interno"].includes(session.userType) ||
    !canPerformModuleAction(session, "corrective-actions", "view")) {
    return NextResponse.json({ error: "Se requiere una cuenta interna autorizada para Root2Cause." }, { status: 403, headers: noStore });
  }
  const profile = await createAdminClient().from("profiles").select("organization_id,user_type,status,workspace_mode").eq("id", session.authUserId).maybeSingle();
  const role = isAdministrator(session) ? "administrator" : "internal";
  if (profile.error || profile.data?.status !== "active" || profile.data.user_type !== role || profile.data.workspace_mode === "demo" || !profile.data.organization_id) {
    return NextResponse.json({ error: "El perfil interno no está activo o no tiene organización asignada." }, { status: 403, headers: noStore });
  }
  return { session, organizationId: String(profile.data.organization_id) };
}

function canSeeDraft(session: ActiveSession, row: Record<string, unknown>) {
  const processId = typeof row.process_id === "string" ? row.process_id : null;
  return isAdministrator(session) || row.created_by === session.authUserId || Boolean(processId && canAccessProcess(session, processId));
}

export async function GET(request: Request) {
  const current = await actor();
  if (current instanceof NextResponse) return current;
  const id = new URL(request.url).searchParams.get("id");
  const query = createAdminClient().from("root2cause_drafts")
    .select("id,organization_id,process_id,source,current_step,revision,payload,created_by,updated_at,status,finalized_action_id")
    .eq("organization_id", current.organizationId).eq("status", "draft").is("finalized_action_id", null)
    .order("updated_at", { ascending: false }).limit(100);
  if (id) {
    const result = await query.eq("id", id).maybeSingle();
    if (result.error) return NextResponse.json({ error: "La persistencia de borradores Root2Cause requiere el contrato de base de datos pendiente." }, { status: 503, headers: noStore });
    if (!result.data || !canSeeDraft(current.session, result.data as Record<string, unknown>)) return NextResponse.json({ error: "Borrador no disponible para este usuario o proceso." }, { status: 404, headers: noStore });
    return NextResponse.json({ draft: draftResponse(result.data as Record<string, unknown>) }, { headers: noStore });
  }
  const result = await query;
  if (result.error) return NextResponse.json({ error: "La persistencia de borradores Root2Cause requiere el contrato de base de datos pendiente." }, { status: 503, headers: noStore });
  const drafts = (result.data ?? []).filter(row => canSeeDraft(current.session, row as Record<string, unknown>)).map(row => ({
    id: row.id, processId: row.process_id, source: row.source, currentStep: row.current_step,
    revision: row.revision, title: String((row.payload as { draft?: { title?: unknown } })?.draft?.title ?? ""), updatedAt: row.updated_at,
  }));
  return NextResponse.json({ drafts }, { headers: noStore });
}

export async function POST(request: Request) {
  const current = await actor();
  if (current instanceof NextResponse) return current;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || (body.command !== "finalize" && body.command !== undefined)) return NextResponse.json({ error: "Operación de borrador inválida." }, { status: 400, headers: noStore });
  const db = await createClient();
  if (body.command === "finalize") {
    if (typeof body.id !== "string" || !uuid.test(body.id) || !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) return NextResponse.json({ error: "Identificador o revisión inválidos." }, { status: 400, headers: noStore });
    if (!canPerformModuleAction(current.session, "corrective-actions", "create")) return NextResponse.json({ error: "No tienes permiso para finalizar análisis." }, { status: 403, headers: noStore });
    const admin = createAdminClient();
    const stored = await admin.from("root2cause_drafts")
      .select("payload,process_id,organization_id,created_by,status,finalized_action_id")
      .eq("id", body.id).eq("organization_id", current.organizationId).maybeSingle();
    const isRetryableFinalization = stored.data?.status === "finalized" && stored.data.finalized_action_id === body.id;
    if (stored.error || !stored.data || (stored.data.status !== "draft" && !isRetryableFinalization) || !canSeeDraft(current.session, stored.data as Record<string, unknown>)) return NextResponse.json({ error: "No se pudo comprobar el borrador autorizado." }, { status: 404, headers: noStore });
    const finalize = async () => {
      const finalized = await db.rpc("iq_root2cause_finalize_plan", { p_draft_id: body.id, p_expected_revision: body.expectedRevision });
      if (finalized.error) {
        const missing = finalized.error?.code === "PGRST202" || /iq_root2cause_finalize_plan/i.test(finalized.error?.message ?? "");
        const linked = saved.error?.message === "ROOT2CAUSE_CLAIM_ALREADY_LINKED";
    const denied = saved.error?.code === "42501";
    const conflict = /CONCURRENT|REVISION/i.test(finalized.error?.message ?? "");
        return NextResponse.json({ error: missing ? "Finalizar análisis requiere instalar el SQL de persistencia Root2Cause; el borrador se conservó." : conflict ? "El borrador cambió en otra sesión. Recárgalo antes de finalizar." : "No se finalizó el borrador; su contenido permanece guardado." }, { status: missing ? 503 : (conflict || linked) ? 409 : denied ? 403 : 422, headers: noStore });
      }
      if (finalized.data?.id !== body.id || typeof finalized.data?.folio !== "string" || !/^AC-(?:\d{4}-)?\d+$/.test(finalized.data.folio)) {
        return NextResponse.json({ error: "El servidor no confirmó la identidad y el folio AC. Reintenta desde el mismo borrador." }, { status: 502, headers: noStore });
      }
      return NextResponse.json(finalized.data, { headers: noStore });
    };
    if (isRetryableFinalization) return finalize();
    type FinalizePlan = { id?: unknown; ownerUserId?: unknown; causeId?: unknown; causeCategory?: unknown; cause?: unknown };
    type FinalizeCause = { id?: unknown; text?: unknown; category?: unknown };
    const storedPayload = stored.data.payload as { draft?: { plans?: FinalizePlan[]; causeItems?: FinalizeCause[] } } | null;
    const draft = storedPayload?.draft;
    const plans = Array.isArray(draft?.plans) ? draft.plans : [];
    if (!plans.length || plans.some(plan => typeof plan.id !== "string" || !uuid.test(plan.id) || typeof plan.ownerUserId !== "string" || !uuid.test(plan.ownerUserId))) {
      return NextResponse.json({ error: "Asigna a cada acción una persona activa del catálogo interno antes de finalizar." }, { status: 422, headers: noStore });
    }
    const causeItems = Array.isArray(draft?.causeItems) ? draft.causeItems : [];
    if (plans.some(plan => {
      if (!new Set(["workforce", "machinery", "method", "material", "environment", "measurement"]).has(String(plan.causeCategory))) return true;
      if (typeof plan.causeId !== "string") return false;
      const cause = causeItems.find(item => item.id === plan.causeId);
      return !cause || !cause.category || cause.category !== plan.causeCategory ||
        (typeof plan.cause === "string" && typeof cause.text === "string" && plan.cause.trim() !== cause.text.trim());
    })) return NextResponse.json({ error: "Cada acción debe conservar una causa real del Ishikawa y su clasificación M." }, { status: 422, headers: noStore });
    const responsibleIds = [...new Set(plans.map(plan => plan.ownerUserId as string))];
    const responsibleProfiles = await admin.from("profiles")
      .select("id,user_type").in("id", responsibleIds).eq("organization_id", current.organizationId)
      .eq("status", "active").eq("workspace_mode", "production").in("user_type", ["internal", "administrator"]);
    if (responsibleProfiles.error || responsibleProfiles.data?.length !== responsibleIds.length) {
      return NextResponse.json({ error: "Uno de los responsables ya no pertenece al catálogo interno activo de esta organización." }, { status: 409, headers: noStore });
    }
    const processId = typeof stored.data.process_id === "string" ? stored.data.process_id : null;
    if (processId) {
      const [assignments, process] = await Promise.all([
        admin.from("user_process_permissions").select("user_id").eq("process_id", processId).in("user_id", responsibleIds),
        admin.from("processes").select("id,process_owner_user_id").eq("id", processId).eq("organization_id", current.organizationId).maybeSingle(),
      ]);
      if (assignments.error || process.error || !process.data) return NextResponse.json({ error: "No se pudo validar la asignación de responsables al proceso." }, { status: 503, headers: noStore });
      const assigned = new Set([...(assignments.data ?? []).map(row => row.user_id), process.data.process_owner_user_id].filter(Boolean));
      const administrators = new Set((responsibleProfiles.data ?? []).filter(profile => profile.user_type === "administrator").map(profile => profile.id));
      if (responsibleIds.some(id => !assigned.has(id) && !administrators.has(id))) return NextResponse.json({ error: "Un responsable ya no tiene acceso al proceso del análisis." }, { status: 403, headers: noStore });
    }
    return finalize();
  }

  const id = body.id, expectedRevision = body.revision, currentStep = body.currentStep, payload = body.payload;
  if (typeof id !== "string" || !uuid.test(id) || !Number.isInteger(expectedRevision) || Number(expectedRevision) < 0 ||
    !Number.isInteger(currentStep) || Number(currentStep) < 0 || Number(currentStep) > 7 || !payload || typeof payload !== "object" ||
    (payload as { step?: unknown }).step !== currentStep || JSON.stringify(payload).length > 200_000) return NextResponse.json({ error: "El contenido del borrador es inválido o supera el límite permitido." }, { status: 400, headers: noStore });
  const draft = (payload as { draft?: Record<string, unknown> }).draft;
  if (!draft || !["internal", "customer", "system"].includes(String(draft.origin)) || (draft.evidenceId !== id) ||
    (draft.processId != null && (typeof draft.processId !== "string" || draft.processId !== "" && !isAdministrator(current.session) && !canAccessProcess(current.session, draft.processId)))) {
    return NextResponse.json({ error: "El borrador no coincide con el expediente o proceso autorizado." }, { status: 403, headers: noStore });
  }
  if (Number(expectedRevision) === 0 && !canPerformModuleAction(current.session, "corrective-actions", "create")) return NextResponse.json({ error: "No tienes permiso para crear borradores Root2Cause." }, { status: 403, headers: noStore });
  if (Number(expectedRevision) > 0 && !canPerformModuleAction(current.session, "corrective-actions", "update")) return NextResponse.json({ error: "No tienes permiso para editar borradores Root2Cause." }, { status: 403, headers: noStore });
  const source = draft.origin === "customer" ? "customer" : draft.origin === "system" ? "sgc" : "internal";
  const saved = await db.rpc("iq_root2cause_save_draft", {
    p_draft_id: id, p_expected_revision: expectedRevision, p_current_step: currentStep,
    p_payload: payload, p_process_id: typeof draft.processId === "string" && draft.processId.trim() ? draft.processId.trim() : null, p_source: source,
    p_customer_id: source === "customer" ? draft.relatedPartyId || null : null,
    p_quality_case_id: source === "customer" ? draft.qualityCaseId || null : null,
  });
  if (saved.error || !saved.data || typeof saved.data.revision !== "number") {
    const missing = saved.error?.code === "PGRST202";
    const linked = saved.error?.message === "ROOT2CAUSE_CLAIM_ALREADY_LINKED";
    const denied = saved.error?.code === "42501";
    const conflict = /CONCURRENT|REVISION/i.test(saved.error?.message ?? "");
    return NextResponse.json({ error: linked ? "El reclamo ya tiene un A3. Abre el expediente desde Reclamos." : denied ? "El servidor denegó el guardado por permisos o alcance del expediente." : missing ? "Guardar en Supabase requiere instalar el contrato de borradores Root2Cause. No se descartó el borrador local." : conflict ? "Otro usuario guardó cambios. Recarga el borrador antes de volver a guardar." : "No se confirmó el guardado. El borrador local permanece disponible." }, { status: missing ? 503 : (conflict || linked) ? 409 : denied ? 403 : 422, headers: noStore });
  }
  return NextResponse.json(saved.data, { headers: noStore });
}
