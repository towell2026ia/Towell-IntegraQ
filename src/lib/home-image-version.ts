"use client";
import { getDocumentPermissions, type ControlledDocument, type ControlledDocumentVersion } from "./document-control-data";
import { getControlledDocumentDownloadUrl, uploadNewControlledDocumentVersion } from "./document-storage";
import { isAdministrator, type ActiveSession } from "./session-data";
export function imageMimeFromHeader(bytes: Uint8Array): string | null {
  if ([137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return "image/webp";
  return null;
}
export async function createInstitutionalImageVersion(input: {
  document: ControlledDocument; session: ActiveSession; reason: string; file?: File; restoreVersionId?: string;
}): Promise<ControlledDocumentVersion> {
  const { document, session, reason } = input;
  if (!isAdministrator(session) || !getDocumentPermissions(session, document.processId).version) throw new Error("Acción exclusiva para administrador autorizado.");
  if (!reason.trim()) throw new Error("Indica el motivo del cambio.");
  if (document.versions.some(version => version.status === "draft" || version.status === "pending")) throw new Error("Finaliza la validación de la versión en preparación antes de crear otra.");
  if (Boolean(input.file) === Boolean(input.restoreVersionId)) throw new Error("Selecciona un archivo nuevo o una versión anterior.");
  let file = input.file;
  if (input.restoreVersionId) {
    const original = document.versions.find(version => version.id === input.restoreVersionId);
    if (!original?.storageObjectPath) throw new Error("La versión seleccionada no tiene un original recuperable.");
    const url = await getControlledDocumentDownloadUrl(original);
    if (!url) throw new Error("No fue posible consultar el archivo original.");
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("No fue posible recuperar el archivo original.");
    file = new File([await response.blob()], original.fileName);
  }
  if (!file || !file.size || file.size > 50 * 1024 * 1024) throw new Error("Selecciona una imagen de hasta 50 MB.");
  const mime = imageMimeFromHeader(new Uint8Array(await file.slice(0,12).arrayBuffer()));
  if (!mime) throw new Error("El archivo debe ser una imagen PNG, JPEG o WebP.");
  return uploadNewControlledDocumentVersion({ document, session, file: new File([file], file.name, { type: mime }),
    revision: Math.max(-1, ...document.versions.map(version => version.revision)) + 1,
    changeReason: reason.trim(), changeSummary: input.restoreVersionId ? `Recuperación del archivo original de la versión ${input.restoreVersionId}, conservando todas las versiones anteriores.` : "Nueva imagen institucional; se conservan las versiones anteriores." });
}