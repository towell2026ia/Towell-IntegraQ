import type { A3Analysis, CorrectiveAction } from "@/lib/types";

export async function loadStoredCorrectiveActions(): Promise<CorrectiveAction[]> {
  const response = await fetch("/api/root2cause/internal-actions", { cache: "no-store" });
  const body = await response.json() as { actions?: Record<string, unknown>[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible consultar Root2Cause.");
  return (body.actions ?? []).map(mapStoredAction);
}

export function mapStoredAction(row: Record<string, unknown>): CorrectiveAction {
  const a3Row = row.corrective_action_a3 as Record<string, unknown> | null;
  const plans = (row.corrective_action_plans ?? []) as Record<string, unknown>[];
  const metadata = a3Row?.workflow_metadata && typeof a3Row.workflow_metadata === "object" ? a3Row.workflow_metadata as Record<string, unknown> : {};
  const a3: A3Analysis | undefined = a3Row ? {
    evidenceId: typeof metadata.evidenceId === "string" ? metadata.evidenceId : undefined,
    rootCauseCauseId: typeof metadata.rootCauseCauseId === "string" ? metadata.rootCauseCauseId : undefined,
    eventType: String(a3Row.event_type ?? ""), severityJustification: String(a3Row.severity_justification ?? ""),
    descriptiveTitle: typeof metadata.descriptiveTitle === "string" ? metadata.descriptiveTitle : undefined,
    brainstormIds: Array.isArray(metadata.brainstormIds) ? metadata.brainstormIds as string[] : undefined,
    causeItems: Array.isArray(metadata.causeItems) ? metadata.causeItems as NonNullable<A3Analysis["causeItems"]> : undefined,
    fiveW2H: (a3Row.five_w_two_h ?? {}) as A3Analysis["fiveW2H"],
    brainstorm: (a3Row.brainstorm ?? []) as string[], ishikawa: (a3Row.ishikawa ?? {}) as A3Analysis["ishikawa"],
    nonDetectionCause: String(a3Row.non_detection_cause ?? ""),
    nonDetectionWhys: (a3Row.non_detection_whys ?? []) as string[], rootCause: String(a3Row.root_cause ?? ""),
    rootCauseWhys: (a3Row.root_cause_whys ?? []) as string[],
    plans: plans.map(plan => ({ id: String(plan.id), description: String(plan.description),
      owner: String(plan.owner_name ?? ""), dueDate: String(plan.due_date),
      ownerUserId: typeof plan.owner_id === "string" ? plan.owner_id : undefined,
      causeCategory: plan.cause_category as A3Analysis["plans"][number]["causeCategory"] ?? undefined,
      cause: typeof plan.cause_text === "string" ? plan.cause_text : undefined,
      causeId: typeof plan.cause_reference_id === "string" ? plan.cause_reference_id : undefined,
      expectedResult: typeof plan.expected_result === "string" ? plan.expected_result : undefined,
      completionEvidence: typeof plan.completion_evidence === "string" ? plan.completion_evidence : undefined,
      effectivenessMethod: typeof plan.effectiveness_method === "string" ? plan.effectiveness_method : undefined,
      status: plan.status as A3Analysis["plans"][number]["status"] })),
  } : undefined;
  return {
    readAuthorizedFor: typeof row.read_authorized_for === "string" ? row.read_authorized_for : undefined,
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
    externalReference: row.external_reference ? String(row.external_reference) : undefined,
    portalVisible: Boolean(row.portal_visible), a3,
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
    deletedBy: row.deleted_by ? String(row.deleted_by) : undefined,
    deletionReason: row.deletion_reason ? String(row.deletion_reason) : undefined,
  };
}
