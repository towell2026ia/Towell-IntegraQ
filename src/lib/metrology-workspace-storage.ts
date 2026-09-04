import type { MetrologyWorkspaceState } from "@/lib/metrology-report-data";

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible completar la operación de metrología.");
  return body;
}

export async function loadMetrologyWorkspace() {
  return parseResponse<{ workspace: MetrologyWorkspaceState; updatedAt: string; storage: "supabase" }>(await fetch("/api/metrology/workspace", { cache: "no-store" }));
}

export async function saveMetrologyWorkspace(workspace: MetrologyWorkspaceState) {
  return parseResponse<{ workspace: MetrologyWorkspaceState; updatedAt: string }>(await fetch("/api/metrology/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace }) }));
}
