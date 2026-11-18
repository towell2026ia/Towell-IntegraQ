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

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "No fue posible guardar o recuperar el borrador Root2Cause.");
  return body;
}

export async function listRootCauseDrafts() {
  const body = await json<{ drafts: Omit<RootCauseStoredDraft, "payload">[] }>(await fetch("/api/root2cause/drafts", { cache: "no-store" }));
  return body.drafts;
}

export async function loadRootCauseDraft(id: string) {
  return json<{ draft: RootCauseStoredDraft }>(await fetch(`/api/root2cause/drafts?id=${encodeURIComponent(id)}`, { cache: "no-store" }));
}

export async function saveRootCauseDraft(input: { id: string; revision: number; currentStep: number; payload: RootCauseStoredDraft["payload"] }) {
  return json<{ id: string; revision: number; updatedAt: string }>(await fetch("/api/root2cause/drafts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }));
}

export async function finalizeRootCauseDraft(id: string, expectedRevision: number) {
  return json<{ id: string; folio: string; title: string; replayed: boolean }>(await fetch("/api/root2cause/drafts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "finalize", id, expectedRevision }),
  }));
}
