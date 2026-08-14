import type {
  CorrectiveAction,
  CorrectiveActionStatus,
  DueStatus,
  MeasurementAsset,
} from "@/lib/types";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.ceil(
    (parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_IN_MS,
  );
}

export function isCorrectiveActionOverdue(
  action: CorrectiveAction,
  today: string,
): boolean {
  return action.status !== "closed" && daysBetween(today, action.dueDate) < 0;
}

export function getCorrectiveActionLabel(
  status: CorrectiveActionStatus,
): string {
  const labels: Record<CorrectiveActionStatus, string> = {
    open: "Abierta",
    analysis: "En análisis",
    action_plan: "Plan de acción",
    implementation: "En ejecución",
    effectiveness: "Validando eficacia",
    closed: "Cerrada",
  };

  return labels[status];
}

export function getDueStatus(
  nextDueDate: string,
  today: string,
  warningDays = 30,
): DueStatus {
  const remainingDays = daysBetween(today, nextDueDate);

  if (remainingDays < 0) {
    return "overdue";
  }

  if (remainingDays <= warningDays) {
    return "due_soon";
  }

  return "current";
}

export function getAssetDueStatus(
  asset: MeasurementAsset,
  today: string,
): DueStatus {
  return getDueStatus(asset.nextDueDate, today);
}

export function calculateNextDueDate(
  completionDate: string,
  frequencyMonths: number,
): string {
  if (!Number.isInteger(frequencyMonths) || frequencyMonths < 1) {
    throw new Error("La frecuencia debe ser un número entero mayor a cero.");
  }

  const completed = parseIsoDate(completionDate);
  const originalDay = completed.getUTCDate();
  const target = new Date(
    Date.UTC(
      completed.getUTCFullYear(),
      completed.getUTCMonth() + frequencyMonths,
      1,
    ),
  );
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();

  target.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return toIsoDate(target);
}
