import { claimFileMime, CLAIM_FILE_LIMIT } from "@/lib/customer-claim-files";
// Reuse the existing binary validation without accepting email exports in this library.
export const CERTIFICATION_FILE_LIMIT = CLAIM_FILE_LIMIT;
export function certificationFileMime(name: string, bytes: Uint8Array) {
  if (!/\.(pdf|jpe?g|png|webp|docx?|xlsx)$/i.test(name)) throw new Error("Usa PDF, JPG, PNG, WEBP, Word o XLSX (máximo 4 MB).");
  return claimFileMime(name,bytes);
}
