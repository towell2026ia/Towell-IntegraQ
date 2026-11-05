export const CLAIM_FILE_LIMIT = 4 * 1024 * 1024;
export function claimFileMime(name: string, bytes: Uint8Array) {
  const ext = name.split(".").pop()?.toLowerCase();
  const starts = (...values: number[]) => values.every((v,i) => bytes[i] === v);
  const text = new TextDecoder().decode(bytes.slice(0,4096));
  if (!bytes.length || bytes.length > CLAIM_FILE_LIMIT) throw new Error("El archivo debe pesar entre 1 byte y 4 MB.");
  if (ext === "pdf" && text.startsWith("%PDF-")) return "application/pdf";
  if (["jpg","jpeg"].includes(ext ?? "") && starts(255,216,255)) return "image/jpeg";
  if (ext === "png" && starts(137,80,78,71,13,10,26,10)) return "image/png";
  if (ext === "webp" && text.slice(0,4)==="RIFF" && text.slice(8,12)==="WEBP") return "image/webp";
  if (ext === "docx" && starts(80,75,3,4)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "xlsx" && starts(80,75,3,4)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (["doc","msg"].includes(ext ?? "") && starts(208,207,17,224,161,177,26,225)) return ext === "msg" ? "application/vnd.ms-outlook" : "application/msword";
  if (ext === "eml" && !text.includes("\0") && /^(From|To|Subject|Date|Received|MIME-Version):/im.test(text)) return "message/rfc822";
  throw new Error("Tipo o contenido no compatible. Usa PDF, JPG, PNG, WEBP, Word, XLSX o correo EML/MSG exportado.");
}
