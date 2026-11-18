import {
  changeWorkspaceDataState,
  fetchWorkspaceData,
  fetchWorkspaceDataRecords,
  upsertWorkspaceData,
} from "@/lib/repositories/workspace-data-repository";
import { isWorkspaceDataArea, type WorkspaceDataArea } from "@/lib/workspace-data";

export async function loadWorkspaceData() {
  return fetchWorkspaceData();
}

export async function loadWorkspaceDataAdministration() {
  return fetchWorkspaceDataRecords();
}

export async function saveWorkspaceData(area: WorkspaceDataArea, data: unknown) {
  if (!isWorkspaceDataArea(area)) throw new Error("Área de persistencia no reconocida.");
  await upsertWorkspaceData(area, data);
}

export async function softDeleteWorkspaceData(area: WorkspaceDataArea, reason: string) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error("La eliminación lógica requiere un motivo.");
  await changeWorkspaceDataState(area, "delete", normalizedReason);
}

export async function restoreWorkspaceData(area: WorkspaceDataArea) {
  await changeWorkspaceDataState(area, "restore");
}
