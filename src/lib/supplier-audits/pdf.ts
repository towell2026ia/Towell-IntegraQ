export async function verifyAuditPdf(bytes: Uint8Array) {
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-" || !new TextDecoder().decode(bytes.slice(-4096)).includes("%%EOF")) throw new Error("El archivo no contiene un PDF válido.");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  Object.assign(globalThis, { pdfjsWorker: worker });
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true });
  try { const pdf = await task.promise; if (pdf.numPages < 1) throw new Error("El PDF no tiene páginas consultables."); await pdf.getPage(1); return pdf.numPages; }
  finally { await task.destroy(); }
}
