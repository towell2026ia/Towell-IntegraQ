/** Browser-only preparation. Stored bytes, not the source, must be hashed/validated. */
export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";
export interface PhotoPolicy {
  allowed: readonly PhotoMime[];
  maxInputBytes: number;
  maxStoredBytes: number;
  maxInputEdge: number;
  maxInputPixels: number;
  maxEdge?: number;
  quality?: number;
}
export interface PhotoPreparation {
  file: File;
  thumbnail: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  storedBytes: number;
  reduction: number;
  elapsedMs: number;
  transformed: boolean;
}
const prepared = new WeakMap<File, Map<string, Promise<PhotoPreparation>>>();
const generated = new WeakSet<File>();
const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
export function fitPhoto(width: number, height: number, maxEdge: number) {
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
function mimeOf(name: string): PhotoMime | undefined {
  const ext=name.split(".").pop()?.toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : undefined;
}
/** Parse bounded headers BEFORE allocating a decoded bitmap. Animated evidence is rejected. */
export function photoHeader(bytes: Uint8Array): { mime: PhotoMime; width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (i: number, n: number) => String.fromCharCode(...bytes.subarray(i, i + n));
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)) {
    if (tag(12,4) !== "IHDR") throw new Error("PNG no válido.");
    for (let i = 8; i + 12 <= bytes.length;) {
      const size = view.getUint32(i);
      if (size > bytes.length - i - 12) throw new Error("PNG incompleto.");
      if (tag(i+4,4) === "acTL") throw new Error("No se admiten fotografías animadas.");
      i += size + 12;
    }
    return { mime: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 12 && tag(0,4) === "RIFF" && tag(8,4) === "WEBP") {
    let width = 0, height = 0;
    for (let i = 12; i + 8 <= bytes.length;) {
      const size = view.getUint32(i+4,true), type = tag(i,4), start = i+8;
      if (size > bytes.length - start) throw new Error("WEBP incompleto.");
      if (type === "ANIM" || type === "ANMF" || type === "VP8X" && (bytes[start] & 2)) throw new Error("No se admiten fotografías animadas.");
      if (type === "VP8X" && size >= 10) {
        width = 1 + bytes[start+4] + (bytes[start+5]<<8) + (bytes[start+6]<<16);
        height = 1 + bytes[start+7] + (bytes[start+8]<<8) + (bytes[start+9]<<16);
      } else if (type === "VP8 " && size >= 10 && !width) {
        if (tag(start+3,3) !== "\x9d\x01\x2a") throw new Error("WEBP no válido.");
        width = view.getUint16(start+6,true) & 16383; height = view.getUint16(start+8,true) & 16383;
      } else if (type === "VP8L" && size >= 5 && !width) {
        if (bytes[start] !== 47) throw new Error("WEBP no válido.");
        const bits = view.getUint32(start+1,true); width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383);
      }
      i = start + size + (size % 2);
    }
    if (width && height) return { mime: "image/webp", width, height };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    for (let i = 2; i + 3 < bytes.length;) {
      if (bytes[i++] !== 255) throw new Error("JPEG no válido.");
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (i+2 > bytes.length) break;
      const size = view.getUint16(i);
      if (size < 2 || i + size > bytes.length) throw new Error("JPEG incompleto.");
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && size >= 8)
        return { mime: "image/jpeg", width: view.getUint16(i+5), height: view.getUint16(i+3) };
      i += size;
    }
  }
  throw new Error("El contenido debe ser una fotografía JPG, JPEG, PNG o WEBP válida.");
}
function encode(canvas: HTMLCanvasElement, mime: PhotoMime, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, mime, quality));
}
async function canvasOf(image: ImageBitmap, width: number, height: number) {
  await yieldToUI();
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("El navegador no permite preparar la fotografía.");
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  context.drawImage(image,0,0,width,height);
  return canvas;
}
export function preparePhoto(file: File, policy: PhotoPolicy, onPhase?: (phase: string) => void) {
  const key = JSON.stringify(policy);
  let variants = prepared.get(file);
  if (!variants) { variants = new Map(); prepared.set(file,variants); }
  const existing = variants.get(key); if (existing) return existing;
  const operation = prepare(file,policy,onPhase).catch(error => { variants!.delete(key); throw error; });
  variants.set(key,operation); return operation;
}
async function prepare(file: File, policy: PhotoPolicy, onPhase?: (phase: string) => void): Promise<PhotoPreparation> {
  const start = performance.now();
  if (!file.size || file.size > policy.maxInputBytes) throw new Error("La fotografía supera el límite local de preparación o está vacía.");
  if (file.name.length > 180) throw new Error("El nombre de la fotografía admite hasta 180 caracteres.");
  onPhase?.("Validando fotografía");
  const header = photoHeader(new Uint8Array(await file.arrayBuffer()));
  if (!policy.allowed.includes(header.mime) || mimeOf(file.name) !== header.mime || file.type && file.type !== header.mime)
    throw new Error("El contenido, extensión o MIME no coincide con los formatos permitidos.");
  if (!header.width || !header.height || Math.max(header.width,header.height) > policy.maxInputEdge || header.width * header.height > policy.maxInputPixels)
    throw new Error("La resolución de entrada supera los límites del formulario.");
  const maxEdge = policy.maxEdge ?? 2048, quality = policy.quality ?? 0.8;
  if (!Number.isFinite(maxEdge) || maxEdge < 1 || !Number.isFinite(quality) || quality <= 0 || quality > 1) throw new Error("Política de compresión no válida.");
  await yieldToUI();
  // The browser applies EXIF orientation, including mirrored orientations, exactly once.
  const image = await createImageBitmap(file, { imageOrientation: "from-image" });
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (!image.width || !image.height || image.width * image.height > policy.maxInputPixels || Math.max(image.width,image.height) > policy.maxInputEdge)
      throw new Error("La fotografía decodificada supera los límites del formulario.");
    const size = fitPhoto(image.width,image.height,maxEdge);
    let output = file, width = image.width, height = image.height;
    // Already bounded JPEG/WEBP and generated File objects keep their original bytes.
    const boundedLossy = file.size <= policy.maxStoredBytes && header.mime !== "image/png" && size.width === image.width && size.height === image.height;
    if (!generated.has(file) && !boundedLossy) {
      onPhase?.("Comprimiendo fotografía");
      canvas = await canvasOf(image,size.width,size.height);
      const candidates: Blob[] = [];
      if (policy.allowed.includes("image/webp")) {
        const webp = await encode(canvas,"image/webp",quality);
        if (webp?.type === "image/webp") candidates.push(webp);
      }
      // Never convert a transparent PNG to JPEG. PNG is the lossless fallback.
      const fallback = await encode(canvas,header.mime,quality);
      if (fallback?.type === header.mime) candidates.push(fallback);
      const best = candidates.sort((a,b) => a.size-b.size)[0];
      // Meaningful savings only; never trade evidence for a larger/nearly equal file.
      if (best && best.size < file.size * 0.98) {
        const ext = best.type === "image/webp" ? "webp" : best.type === "image/png" ? "png" : "jpg";
        const name = file.name.replace(/\.[^.]+$/,"") + "." + ext;
        output = new File([best],name,{type:best.type,lastModified:file.lastModified});
        generated.add(output); width = size.width; height = size.height;
      }
    }
    if (output.size > policy.maxStoredBytes) throw new Error("La fotografía preparada supera 4 MB. Selecciona una imagen menor o ajusta el detalle.");
    onPhase?.("Generando miniatura");
    const thumbImage = output === file ? image : await createImageBitmap(output, { imageOrientation: "from-image" });
    const thumbSize = fitPhoto(thumbImage.width,thumbImage.height,384);
    const thumbCanvas = await canvasOf(thumbImage,thumbSize.width,thumbSize.height);
    if (thumbImage !== image) thumbImage.close();
    let thumbnail: Blob | null;
    try {
      thumbnail = await encode(thumbCanvas,"image/webp",0.75);
      if (!thumbnail || thumbnail.type !== "image/webp") thumbnail = await encode(thumbCanvas,"image/png",1);
    } finally { thumbCanvas.width = 0; thumbCanvas.height = 0; }
    if (!thumbnail) throw new Error("No se pudo preparar la miniatura.");
    if (thumbnail.size > output.size) thumbnail = output;
    return { file:output, thumbnail, width, height, originalWidth:image.width, originalHeight:image.height, originalBytes:file.size,
      storedBytes:output.size, reduction:1-output.size/file.size, elapsedMs:performance.now()-start, transformed:output !== file };
  } finally { image.close(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
}
