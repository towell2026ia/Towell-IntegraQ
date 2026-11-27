import type { ManagementReviewDecision } from "./management-review-data";

export const classifications = {
  improvement: "Oportunidad de mejora",
  change: "Cambios en el Sistema de Gestión de Calidad",
  resources: "Necesidad de recursos",
};
export const priorities = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
} satisfies Record<string, ManagementReviewDecision["priority"]>;
export const authorization = {
  draft: "Borrador",
  review: "En validación",
  authorized: "Autorizado",
  cancelled: "Cancelado",
};
export const execution = {
  pending: "Pendiente",
  in_progress: "En proceso",
  review: "Pendiente de validación",
  completed: "Concluido",
  cancelled: "Cancelado",
};
export const commands = {
  create: "Registro",
  amend: "Editar borrador",
  assign: "Reasignar responsable",
  submit: "Validar y enviar a Operaciones",
  authorize: "Autorizar decisión",
  return: "Devolver a borrador",
  cancel: "Cancelar acuerdo",
  action: "Agregar acción",
  assign_action: "Reasignar acción",
  cancel_action: "Cancelar acción",
  progress: "Registrar avance",
  validate_action: "Validar cumplimiento",
  reopen_action: "Devolver o reabrir acción",
  close: "Validar y cerrar acuerdo",
  reopen: "Reabrir acuerdo",
};
export type Command = keyof typeof commands;
export interface Output {
  id: string;
  folio: string;
  origin_year: number;
  agreement_date: string;
  title: string;
  description: ManagementReviewDecision["description"];
  classification: keyof typeof classifications;
  section_id: string;
  priority: keyof typeof priorities;
  auth_state: keyof typeof authorization;
  execution: keyof typeof execution;
  actionable: boolean;
  due_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
  revision: number;
  justification: string | null;
  resources: string | null;
  process_id: string | null;
  evidence_file_id: string | null;
  review_id: string | null;
  source_link_id: string | null;
  historic: boolean;
  historic_item: string | null;
  resolution: string | null;
  completed_at: string | null;
}
export interface Action {
  id: string;
  decision_id: string;
  description: string;
  owner_name: string;
  owner_id: string;
  starts: string;
  due: string;
  actual: string | null;
  progress: number;
  state: keyof typeof execution;
  result: string | null;
  file_id: string | null;
  requires_evidence: boolean;
}
export interface OutputEvent {
  operation_id: string;
  actor: string;
  actor_name: string | null;
  assignee_name: string | null;
  action_id: string | null;
  command: Command;
  expected_revision: number;
  occurred_at: string;
  detail: Record<string, string | number | boolean | null>;
}
export interface OutputContext {
  admin: boolean;
  director: boolean;
  update: boolean;
  actor: string;
  people: {
    id: string;
    name: string;
    position: string | null;
    process: string | null;
  }[];
  reports: {
    id: string;
    year: number;
    label: string;
    sources: { id: string; type: string }[];
  }[];
  processes: { id: string; name: string }[];
}
export type Metric =
  | "all"
  | "authorized"
  | "working"
  | "closed"
  | "overdue"
  | "previous"
  | "received"
  | "completedYear";
const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const localDate = (instant: string) =>
  calendar.format(new Date(instant));
export const todayInMexico = () => calendar.format(new Date());
export const late = (
  due: string | null,
  state: keyof typeof execution,
  today: string,
) => !!due && due < today && state !== "completed" && state !== "cancelled";
export function cohort(
  rows: Output[],
  year: number,
  metric: Metric,
  today: string,
) {
  return rows.filter((d) => {
    const approved = d.auth_state === "authorized";
    if (metric === "previous")
      return d.origin_year < year && approved && d.execution !== "completed";
    if (metric === "completedYear")
      return (
        approved &&
        d.execution === "completed" &&
        !!d.completed_at &&
        localDate(d.completed_at).startsWith(String(year) + "-")
      );
    if (d.origin_year !== year) return false;
    switch (metric) {
      case "all":
        return true;
      case "working":
        return approved && d.execution === "in_progress";
      case "closed":
      case "received":
        return approved && d.execution === "completed";
      case "overdue":
        return approved && late(d.due_date, d.execution, today);
      default:
        return approved;
    }
  });
}
export function outputMetrics(rows: Output[], year: number, today: string) {
  const count = (metric: Metric) => cohort(rows, year, metric, today).length;
  const authorized = count("authorized"),
    closed = count("closed");
  const withDeadline = cohort(rows, year, "authorized", today).filter(
    (d) => d.due_date,
  );
  const onTime = withDeadline.filter(
    (d) =>
      d.execution === "completed" &&
      d.completed_at &&
      localDate(d.completed_at) <= d.due_date!,
  ).length;
  return {
    onTime: withDeadline.length
      ? Math.round((1000 * onTime) / withDeadline.length) / 10
      : null,
    authorized,
    working: count("working"),
    closed,
    overdue: count("overdue"),
    previous: count("previous"),
    received: authorized ? Math.round((1000 * closed) / authorized) / 10 : null,
  };
}
export function meanProgress(actions: Action[]) {
  const active = actions.filter((a) => a.state !== "cancelled");
  return active.length
    ? Math.round(active.reduce((sum, a) => sum + a.progress, 0) / active.length)
    : null;
}
