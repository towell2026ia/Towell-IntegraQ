import type {
  GeneralInformationDocumentInput,
  GeneralInformationSnapshot,
  GeneralInformationUploadResult,
} from "@/lib/general-information";

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "No fue posible completar la operación documental.");
  return payload;
}

export async function fetchGeneralInformation(parameters: {
  folderId?: string;
  query?: string;
  referenceType?: string;
  validityStatus?: string;
  sort?: string;
  administrationView?: "active" | "deleted" | "history" | "audit";
} = {}) {
  const query = new URLSearchParams();
  if (parameters.folderId) query.set("folderId", parameters.folderId);
  if (parameters.query) query.set("q", parameters.query);
  if (parameters.referenceType) query.set("reference", parameters.referenceType);
  if (parameters.validityStatus) query.set("validity", parameters.validityStatus);
  if (parameters.sort) query.set("sort", parameters.sort);
  if (parameters.administrationView) query.set("view", parameters.administrationView);
  return readJson<GeneralInformationSnapshot>(
    await fetch(`/api/information-general?${query.toString()}`, { cache: "no-store" }),
  );
}

export async function createGeneralInformationFolder(input: {
  name: string;
  description?: string;
  parentFolderId?: string;
}) {
  return readJson(await fetch("/api/information-general", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "createFolder", ...input }),
  }));
}

export async function patchGeneralInformation(input: Record<string, unknown>) {
  return readJson(await fetch("/api/information-general", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export function uploadGeneralInformation(
  files: File[],
  metadata: GeneralInformationDocumentInput[],
  onProgress?: (percent: number) => void,
  replaceDocumentId?: string,
) {
  return new Promise<GeneralInformationUploadResult>((resolve, reject) => {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    form.set("manifest", JSON.stringify(metadata));
    if (replaceDocumentId) form.set("replaceDocumentId", replaceDocumentId);
    const request = new XMLHttpRequest();
    request.open("POST", "/api/information-general");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100));
    };
    request.onerror = () => reject(new Error("No fue posible enviar los archivos."));
    request.onload = () => {
      const payload = JSON.parse(request.responseText || "{}") as GeneralInformationUploadResult & { error?: string };
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload.error || "No fue posible cargar los documentos."));
      } else {
        onProgress?.(100);
        resolve(payload);
      }
    };
    request.send(form);
  });
}

export async function getGeneralInformationFileUrl(
  documentId: string,
  disposition: "preview" | "download",
) {
  const response = await fetch(`/api/information-general/documents/${encodeURIComponent(documentId)}/file?disposition=${disposition}`, { cache: "no-store" });
  return readJson<{ signedUrl: string }>(response);
}
