import type { MatrixDashboard, MatrixFilters, RncpSettings } from "./model";
export type MatrixResult = MatrixDashboard & { settings: RncpSettings; settingsRevision: number; reviewsRevision: number; isInspector: boolean; aiConfigured: boolean; notificationsEnabled: boolean };
export async function rncpRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/suppliers/rncp${path}`, { ...init, cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error ?? "No se pudo completar la operación RNCP.");
  return result as T;
}
export function matrixQuery(filters: MatrixFilters) {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
}
export function followupCommand<T = unknown>(command: string, payload: Record<string, unknown>) {
  return rncpRequest<T>("/follow-up", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command, ...payload }) });
}
