import type { A3Analysis, CorrectiveAction } from "@/lib/types";

export async function loadStoredCorrectiveActions(): Promise<CorrectiveAction[]> {
  const response = await fetch("/api/root2cause/internal-actions", { cache: "no-store" });
  const body = await response.json() as { actions?: Record<string, unknown>[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible consultar Root2Cause.");
  return (body.actions ?? []).map(mapStoredAction);
}

function mapStoredAction(row: Record<string, unknown>): CorrectiveAction {
  const a3Row = row.corrective_action_a3 as Record<string, unknown> | null;
  const plans = (row.corrective_action_plans ?? []) as Record<string, unknown>[];
  const a3: A3Analysis | undefined = a3Row ? {
    eventType: String(a3Row.event_type ?? ""), severityJustification: String(a3Row.severity_justification ?? ""),
    fiveW2H: (a3Row.five_w_two_h ?? {}) as A3Analysis["fiveW2H"],
    brainstorm: (a3Row.brainstorm ?? []) as string[], ishikawa: (a3Row.ishikawa ?? {}) as A3Analysis["ishikawa"],
    nonDetectionCause: String(a3Row.non_detection_cause ?? ""),
    nonDetectionWhys: (a3Row.non_detection_whys ?? []) as string[], rootCause: String(a3Row.root_cause ?? ""),
    rootCauseWhys: (a3Row.root_cause_whys ?? []) as string[],
    plans: plans.map(plan => ({ id: String(plan.id), description: String(plan.description),
      owner: String(plan.owner_name ?? ""), dueDate: String(plan.due_date),
      status: plan.status as A3Analysis["plans"][number]["status"] })),
  } : undefined;
  return {
    id: String(row.id), organizationId: row.organization_id ? String(row.organization_id) : undefined,
    folio: String(row.folio), title: String(row.title), problem: String(row.problem),
    source: row.source as CorrectiveAction["source"], severity: row.severity as CorrectiveAction["severity"],
    processId: row.process_id ? String(row.process_id) : undefined, area: String(row.area ?? ""),
    owner: String(row.owner_name ?? ""), ownerId: row.owner_id ? String(row.owner_id) : undefined,
    createdAt: String(row.created_at).slice(0, 10), dueDate: String(row.due_date),
    status: row.status as CorrectiveAction["status"], progress: Number(row.progress ?? 0),
    evidenceCount: plans.filter(plan => plan.evidence_file_id).length,
    rootCause: row.root_cause ? String(row.root_cause) : undefined,
    relatedPartyId: row.external_organization_id ? String(row.external_organization_id) : undefined,
    qualityCaseId: row.quality_case_id ? String(row.quality_case_id) : undefined,
    portalVisible: Boolean(row.portal_visible), a3,
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
    deletedBy: row.deleted_by ? String(row.deleted_by) : undefined,
    deletionReason: row.deletion_reason ? String(row.deletion_reason) : undefined,
  };
}
