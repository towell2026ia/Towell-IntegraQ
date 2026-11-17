export const INITIAL_PHOTO_RESOURCE = "supplier_rncp_initial_photo";
export const MAX_INITIAL_PHOTOS = 12;
export const MAX_INITIAL_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_INITIAL_PHOTO_TOTAL = 24 * 1024 * 1024;
export const MAX_INITIAL_PHOTO_PIXELS = 25_000_000;
export interface InitialPhoto { id: string; name: string; sha256: string; size: number; mime: string; width: number; height: number; }
export interface InitialPhotoManifest { revision: number; files: InitialPhoto[]; }
export function imagePhotoMime(bytes: Uint8Array) {
 if ([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)) return "image/png";
 if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return "image/jpeg";
 if (String.fromCharCode(...bytes.slice(0,4))==="RIFF" && String.fromCharCode(...bytes.slice(8,12))==="WEBP") return "image/webp";
 return null;
}
export function validatePhotoEnvelope(name:string, size:number, bytes:Uint8Array, declared="") {
 if (name.length>180) throw new Error("El nombre de la fotografía admite hasta 180 caracteres.");
 if (!size || size>MAX_INITIAL_PHOTO_BYTES) throw new Error("Cada fotografía debe pesar hasta 4 MB.");
 const mime=imagePhotoMime(bytes),ext=name.split(".").pop()?.toLowerCase();
 const expected=ext==="png"?"image/png":ext==="webp"?"image/webp":["jpg","jpeg"].includes(ext??"")?"image/jpeg":null;
 if (!mime || mime!==expected || declared && declared!==mime) throw new Error("El contenido debe corresponder a JPG, JPEG, PNG o WEBP.");
 return mime;
}
export function validatePhotoDimensions(width:number,height:number,pages=1) {
 if (!width || !height || width>8192 || height>8192 || width*height>MAX_INITIAL_PHOTO_PIXELS || pages!==1) throw new Error("Fotografía no válida: máximo 8192 píxeles por lado y 25 megapíxeles, sin animación.");
}
export function initialPhotoUrl(reportId:string,fileId:string) { return "/api/suppliers/rncp/photos/"+encodeURIComponent(fileId)+"?reportId="+encodeURIComponent(reportId); }
export function samePhotoOrder(a:readonly string[],b:readonly string[]) { return a.length===b.length && a.every((id,i)=>id===b[i]); }
