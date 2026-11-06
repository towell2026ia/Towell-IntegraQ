export interface PdfRncpIdentity { folio: string | null; supplierCode: string | null; ambiguous: boolean; }
export function parsePdfRncpIdentity(text: string, filename = ""): PdfRncpIdentity {
  const contentFolios = [...new Set([...text.matchAll(/\bRNCP\s*[-:]?\s*(0*\d{1,8})\b/gi)].map(m => `RNCP${m[1].padStart(4, "0")}`))];
  const codes = [...new Set([...text.matchAll(/\bPR\s*(\d{3,8})\b/gi)].map(m => `PR${m[1]}`))];
  const fileFolio = filename.match(/\bRNCP\s*[-_ ]?\s*(0*\d{1,8})\b/i);
  const claimed = fileFolio ? `RNCP${fileFolio[1].padStart(4, "0")}` : null;
  return { folio: contentFolios.length === 1 ? contentFolios[0] : null,
    supplierCode: codes.length === 1 ? codes[0] : null,
    ambiguous: contentFolios.length !== 1 || codes.length !== 1 || Boolean(claimed && contentFolios[0] !== claimed) };
}
export async function readRncpPdf(bytes: Uint8Array) {
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("El archivo no es un PDF válido.");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Explicit import keeps the Node worker in Next's server bundle. A relative
  // workerSrc otherwise points at a missing .next/server/chunks/pdf.worker.mjs.
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  Object.assign(globalThis, { pdfjsWorker: worker });
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true });
  const document = await task.promise;
  try {
    if (document.numPages > 100) throw new Error("El PDF supera el máximo de 100 páginas para conciliación automática.");
    let text = "";
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      text += " " + content.items.map(item => "str" in item ? item.str : "").join(" ");
    }
    return text;
  } finally { await task.destroy(); }
}
