export interface RootCauseStoredDraft {
  id: string;
  revision: number;
  currentStep: number;
  payload: { step: number; draft: Record<string, unknown>; aiDraft?: unknown; newIdea?: string; causeInputs?: Record<string, string> };
  processId: string | null;
  source: "internal" | "customer" | "sgc";
  updatedAt: string;
  title?: string;
}

export class RootCauseHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function readRootCauseJson<T>(response: Response): Promise<T> {
  const type = response.headers.get("content-type") ?? "";
  if (!/application\/(?:json|[\w.+-]+\+json)\b/i.test(type)) {
    throw new Error(response.status === 504 ? "El servidor agotó el tiempo de espera (HTTP 504)." :
      "Respuesta inesperada del servidor (HTTP " + response.status + ").");
  }
  let body;
  try { body = await response.json(); }
  catch { throw new Error("Respuesta JSON incompleta (HTTP " + response.status + ")."); }
  if (!body || typeof body !== "object") throw new Error("El servidor devolvió una respuesta vacía.");
  if (!response.ok) throw new RootCauseHttpError(response.status, typeof body.error === "string" ? body.error : "La solicitud falló (HTTP " + response.status + ").");
  return body;
}

export async function listRootCauseDrafts() {
  const body = await readRootCauseJson<{ drafts: Omit<RootCauseStoredDraft, "payload">[] }>(await fetch("/api/root2cause/drafts", { cache: "no-store" }));
  return body.drafts;
}

export async function loadRootCauseDraft(id: string) {
  return readRootCauseJson<{ draft: RootCauseStoredDraft }>(await fetch(`/api/root2cause/drafts?id=${encodeURIComponent(id)}`, { cache: "no-store" }));
}

export async function saveRootCauseDraft(input: { id: string; revision: number; currentStep: number; payload: RootCauseStoredDraft["payload"] }) {
  const result = await readRootCauseJson<{ id: string; revision: number; updatedAt: string }>(await fetch("/api/root2cause/drafts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }));
  if (result.id !== input.id || result.revision !== input.revision + 1) throw new Error("Supabase no confirmó la identidad y revisión esperadas.");
  return result;
}

export async function finalizeRootCauseDraft(id: string, expectedRevision: number) {
  const result = await readRootCauseJson<{ id: string; folio: string; title: string; replayed: boolean }>(await fetch("/api/root2cause/drafts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "finalize", id, expectedRevision }),
  }));
  if (result.id !== id || !/^AC-[0-9]+(?:-[0-9]+)*$/.test(result.folio)) throw new Error("El servidor no confirmó el expediente y su folio AC.");
  return result;
}
