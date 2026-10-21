import { type RiskRecord, type RiskWorkspaceState } from "./risk-opportunity-data";
export { classifyRisk } from "./risk-classification.mjs";

export type RiskClassification = "REAL" | "EXPLICIT_DEMO_TEST" | "AMBIGUOUS";
const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([,x]) => x !== undefined).sort(([a],[b]) => a.localeCompare(b))) : v);

// PUT cannot remove history, forge tombstones, edit deleted records or remove linked actions.
export function validateRiskHistory(current: RiskWorkspaceState, proposed: RiskWorkspaceState) {
  if (new Set(proposed.risks.map(r => r.id)).size !== proposed.risks.length) throw new Error("Folio duplicado.");
  if (new Set(proposed.actions.map(a => a.id)).size !== proposed.actions.length) throw new Error("Folio de acción duplicado.");
  for (const previous of current.risks) {
    const next = proposed.risks.find(r => r.id === previous.id);
    if (!next) throw new Error("Los riesgos requieren eliminación administrativa con motivo.");
    for (const key of ["deletedAt", "deletedBy", "deletionReason", "deletionCategory"] as const) {
      if (next[key] !== previous[key]) throw new Error("Usa la operación administrativa de eliminación/restauración.");
    }
    if (previous.deletedAt && canonical(next) !== canonical(previous)) throw new Error("Restaura el registro antes de editarlo.");
  }
  for (const next of proposed.risks) if (!current.risks.some(r => r.id === next.id) && (next.deletedAt || next.deletedBy || next.deletionReason || next.deletionCategory)) throw new Error("Metadata de eliminación inválida.");
  for (const action of current.actions) if (!proposed.actions.some(a => a.id === action.id)) throw new Error("Las acciones se conservan en el histórico.");
  for (const action of proposed.actions) {
    const risk = proposed.risks.find(r => r.id === action.riskId);
    if (!risk) throw new Error("Acción sin riesgo asociado.");
    if (risk.deletedAt && canonical(current.actions.find(a => a.id === action.id)) !== canonical(action)) throw new Error("No se modifican acciones de registros eliminados.");
  }
}

export type RiskEventType = "risk.analysis_started" | "risk.created" | "risk.updated" | "risk.action_assigned" | "risk.action_due" | "risk.action_overdue" | "risk.reevaluation_required" | "risk.effectiveness_pending" | "risk.critical" | "risk.closed" | "risk.deleted" | "risk.restored";
export type RiskEvent = { type: RiskEventType; resourceId: string; processId?: string; ownerId?: string; title: string; body: string; targetUrl: string; occurrence: string };

export function riskEvents(current: RiskWorkspaceState, next: RiskWorkspaceState, now = new Date()): RiskEvent[] {
  const result: RiskEvent[] = [];
  const day = now.toISOString().slice(0,10);
  const emit = (type: RiskEventType, risk: RiskRecord, occurrence: string, action?: RiskWorkspaceState["actions"][number]) => result.push({ type, resourceId: action?.id ?? risk.id, processId: risk.processId, ownerId: action?.ownerId, title: `${type} · ${risk.id}`, body: `${risk.kind === "risk" ? "Riesgo" : "Oportunidad"}: ${risk.title}\nProceso: ${risk.processId}\nResponsable: ${action?.owner ?? risk.owner}\nAcción requerida: ${action?.title ?? type}\n${action ? `Fecha compromiso: ${action.dueDate}` : ""}`, targetUrl: `/?risk=${encodeURIComponent(risk.id)}#risks`, occurrence });
  if (current.cycleStatus !== "active" && next.cycleStatus === "active") result.push({ type:"risk.analysis_started",resourceId:String(next.cycle),title:`Análisis anual ${next.cycle} iniciado`,body:"Iniciar FODA, evaluación y seguimiento de riesgos de los procesos autorizados.",targetUrl:"/#risks",occurrence:String(next.cycle) });
  for (const risk of next.risks) {
    if (risk.deletedAt) continue;
    const old = current.risks.find(r => r.id === risk.id);
    if (!old) emit("risk.created", risk, canonical(risk));
    else if (canonical(old) !== canonical(risk)) emit("risk.updated", risk, canonical(risk));
    if (risk.status === "closed" && old?.status !== "closed") emit("risk.closed", risk, canonical(risk));
    if (risk.status === "effectiveness_pending" && old?.status !== risk.status) emit("risk.effectiveness_pending",risk,canonical(risk));
    if ((risk.latest ?? risk.initial).level === "CRÍTICO" && (!old || (old.latest ?? old.initial).level !== "CRÍTICO")) emit("risk.critical",risk,canonical(risk));
    for (const action of next.actions.filter(a=>a.riskId===risk.id && risk.status!=="closed")) {
      const previous=current.actions.find(a=>a.id===action.id);
      if (!previous || previous.ownerId !== action.ownerId || previous.owner !== action.owner) emit("risk.action_assigned",risk,canonical(action),action);
      if (action.status === "completed" && previous?.status !== "completed") emit("risk.reevaluation_required",risk,canonical(action),action);
      if (action.status === "completed" && action.effectiveness === "pending" && (previous?.status !== "completed" || previous.effectiveness !== "pending")) emit("risk.effectiveness_pending",risk,canonical(action),action);
      if (action.status !== "completed" && action.dueDate < day) emit("risk.action_overdue",risk,action.dueDate,action);
      else if (action.status !== "completed" && action.dueDate <= new Date(now.getTime()+3*86400000).toISOString().slice(0,10)) emit("risk.action_due",risk,action.dueDate,action);
    }
  }
  return result;
}
