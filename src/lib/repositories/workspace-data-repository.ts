import type { WorkspaceDataArea, WorkspaceDataSnapshot } from "@/lib/workspace-data";

async function readJson(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "No fue posible acceder al repositorio del espacio.");
  return payload;
}

export async function fetchWorkspaceData(): Promise<WorkspaceDataSnapshot> {
  const response = await fetch("/api/workspace-data", { cache: "no-store" });
  const payload = await readJson(response) as { data?: WorkspaceDataSnapshot };
  return payload.data ?? {};
}

export interface WorkspaceDataRecord {
  area: WorkspaceDataArea;
  payload: unknown;
  revision: number;
  updated_at: string;
  deleted_at: string | null;
  deletion_reason: string | null;
}

export async function fetchWorkspaceDataRecords(): Promise<WorkspaceDataRecord[]> {
  const response = await fetch("/api/workspace-data?includeDeleted=1", { cache: "no-store" });
  const payload = await readJson(response) as { records?: WorkspaceDataRecord[] };
  return payload.records ?? [];
}

export async function upsertWorkspaceData(area: WorkspaceDataArea, data: unknown) {
  const response = await fetch("/api/workspace-data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ area, data }),
  });
  return readJson(response);
}

export async function changeWorkspaceDataState(
  area: WorkspaceDataArea,
  action: "delete" | "restore",
  reason?: string,
) {
  const response = await fetch("/api/workspace-data", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ area, action, reason }),
  });
  return readJson(response);
}
