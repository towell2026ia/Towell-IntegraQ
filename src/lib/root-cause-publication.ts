import type { CorrectiveAction } from "@/lib/types";

export interface PublishedCorrectiveAction {
  id: string;
  folio: string;
  title: string;
  status: string;
  progress: number;
  dueDate: string;
}

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "No fue posible completar la operación.");
  return body;
}

export async function loadPublishedCorrectiveActions(): Promise<PublishedCorrectiveAction[]> {
  const response = await fetch("/api/root2cause/published-actions", { cache: "no-store" });
  const body = await responseBody<{ actions: PublishedCorrectiveAction[] }>(response);
  return body.actions;
}

export async function publishCorrectiveAction(action: CorrectiveAction): Promise<void> {
  const response = await fetch("/api/root2cause/published-actions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, publish: true }),
  });
  await responseBody<{ ok: true }>(response);
}

export async function saveCorrectiveAction(action: CorrectiveAction): Promise<void> {
  const response = await fetch("/api/root2cause/published-actions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, publish: false }),
  });
  await responseBody<{ ok: true }>(response);
}

export async function unpublishCorrectiveAction(id: string): Promise<void> {
  const response = await fetch("/api/root2cause/published-actions", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
  });
  await responseBody<{ ok: true }>(response);
}

export async function softDeleteStoredCorrectiveAction(id: string, reason: string): Promise<boolean> {
  const response = await fetch("/api/root2cause/published-actions", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reason }),
  });
  if (response.status === 404) throw new Error("El análisis no existe o no pertenece a tu organización.");
  await responseBody<{ ok: true }>(response);
  return true;
}
