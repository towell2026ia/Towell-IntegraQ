export class StateTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION";
}

const transitions: Record<string, Record<string, string[]>> = {
  document: { draft: ["submitted"], submitted: ["under_review", "cancelled"], under_review: ["approved", "rejected"], rejected: ["draft"], approved: ["published"], published: [] },
  corrective_action: { open: ["analysis"], analysis: ["action_plan"], action_plan: ["implementation"], implementation: ["effectiveness_review"], effectiveness_review: ["closed", "implementation"], closed: ["effectiveness_review"] },
  audit: { draft: ["planned"], planned: ["scheduled"], scheduled: ["in_progress"], in_progress: ["report_review"], report_review: ["completed", "in_progress"], completed: ["closed"], closed: ["completed"] },
  risk: { draft: ["evaluation"], evaluation: ["review"], review: ["approved", "rejected"], rejected: ["draft"], approved: ["monitoring"], monitoring: ["closed"], closed: ["monitoring"] },
  improvement: { draft: ["submitted"], submitted: ["under_review", "rejected"], under_review: ["approved", "rejected"], rejected: ["draft"], approved: ["closed"], closed: ["approved"] },
};

export function validateStateTransition(entityType: string, from: string, to: string) {
  if (from === to) return true;
  if (!transitions[entityType]?.[from]?.includes(to)) throw new StateTransitionError(`No se permite cambiar ${entityType} de ${from} a ${to}.`);
  return true;
}
