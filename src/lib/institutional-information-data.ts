export type InstitutionalPosition = "POLICY_QUALITY" | "CODE_ETHICS" | "CONFIDENTIALITY";
export type InstitutionalContentKind = "document" | "text";

export interface InstitutionalItem {
  position: InstitutionalPosition;
  title: string;
  contentKind: InstitutionalContentKind;
  documentId?: string;
  shortText?: string;
  visibleToInternal: boolean;
  visibleToExternal: boolean;
  active: boolean;
  available: boolean;
  document?: { code: string; title: string; revision: number; fileName: string };
}

export interface InstitutionalDocumentOption {
  id: string;
  code: string;
  title: string;
  processId: string;
  currentRevision?: number;
  currentFileName?: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "No fue posible consultar la información institucional.");
  return payload;
}

export async function loadInstitutionalInformation() {
  const response = await fetch("/api/home/institutional", { cache: "no-store" });
  return parseResponse<{ items: InstitutionalItem[]; documents?: InstitutionalDocumentOption[] }>(response);
}

export async function saveInstitutionalItem(item: InstitutionalItem) {
  const response = await fetch("/api/home/institutional", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
  return parseResponse<{ item: InstitutionalItem }>(response);
}

export async function getInstitutionalDocumentUrl(position: InstitutionalPosition) {
  const response = await fetch(`/api/home/institutional/${position}/file`, { cache: "no-store" });
  return parseResponse<{ signedUrl: string; expiresIn: number }>(response);
}
