export type PreviewFit = "width" | "page" | "manual";
export function previewScale(width: number, height: number, availableWidth: number, availableHeight: number, fit: PreviewFit, zoom = 1) {
  const naturalWidth = Math.max(1, width), naturalHeight = Math.max(1, height);
  const base = fit === "manual" ? 1 : fit === "width" ? Math.max(1, availableWidth) / naturalWidth : Math.min(Math.max(1, availableWidth) / naturalWidth, Math.max(1, availableHeight) / naturalHeight);
  return Math.max(0.02, Math.min(4, base * zoom));
}
export function previewIsPdf(bytes: ArrayBuffer, mimeType?: string) {
  return new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-" || mimeType === "application/pdf";
}
export function isPreviewImage(fileName: string, mimeType = "") {
  return mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(fileName);
}
export function sheetWindow(startRow: number, startColumn: number, lastRow: number, lastColumn: number) {
  const row = Math.max(0, Math.min(startRow, lastRow)), column = Math.max(0, Math.min(startColumn, lastColumn));
  return { s: { r: row, c: column }, e: { r: Math.min(lastRow, row + 249), c: Math.min(lastColumn, column + 59) } };
}
export function wordPageSize(xml: string) {
  const page = /<(?:[\w]+:)?pgSz\b[^>]*>/i.exec(xml)?.[0];
  if (!page) return undefined;
  const width = /(?:\w+:)?w=["'](\d+)["']/.exec(page)?.[1];
  const height = /(?:\w+:)?h=["'](\d+)["']/.exec(page)?.[1];
  if (!width || !height || +width <= 0 || +height <= 0) return undefined;
  return { width: +width / 15, minHeight: +height / 15 };
}
/** Read only a bounded OOXML metadata entry; no files are extracted to disk. */
export async function officeXml(bytes: ArrayBuffer, wanted: string): Promise<string | undefined> {
  const view = new DataView(bytes), decoder = new TextDecoder();
  let end = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return undefined;
  let cursor = view.getUint32(end + 16, true);
  for (let n = 0; n < view.getUint16(end + 10, true); n++) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== 0x02014b50) return undefined;
    const nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (name === wanted) {
      const size = view.getUint32(cursor + 24, true), compressed = view.getUint32(cursor + 20, true), offset = view.getUint32(cursor + 42, true);
      if (compressed > 8 * 1024 * 1024 || size > 8 * 1024 * 1024 || offset + 30 > bytes.byteLength || view.getUint16(cursor + 8, true) & 1) return undefined;
      if (view.getUint32(offset, true) !== 0x04034b50) return undefined;
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      if (start + compressed > bytes.byteLength) return undefined;
      const data = bytes.slice(start, start + compressed), method = view.getUint16(cursor + 10, true);
      if (method === 0) return decoder.decode(data);
      if (method !== 8) return undefined;
      const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      const chunks: Uint8Array[] = []; let total = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          total += next.value.length;
          if (total > 8 * 1024 * 1024) { await reader.cancel(); return undefined; }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const result = new Uint8Array(total); let at = 0;
      for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
      return decoder.decode(result);
    }
    cursor += 46 + nameLength + extra + comment;
  }
  return undefined;
}

export async function loadPreviewBytes(
  useConverted: boolean,
  resolve: (target: "original" | "preview") => Promise<string | null>,
  request: typeof fetch = fetch,
) {
  async function read(target: "original" | "preview") {
    const url = await resolve(target);
    if (!url) throw new Error("Este registro no tiene un archivo consultable con tus permisos.");
    const response = await request(url, { cache: "no-store" });
    if (!response.ok) throw new Error("No fue posible abrir el archivo privado.");
    return { bytes: await response.arrayBuffer(), target };
  }
  if (useConverted) { try { return await read("preview"); } catch { return read("original"); } }
  return read("original");
}
