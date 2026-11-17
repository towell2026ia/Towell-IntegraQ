import "server-only";
import sharp from "sharp";
/** Derived response only. No object is written or replaced in Storage. */
export async function privatePhotoThumbnail(bytes:Uint8Array) {
 return sharp(bytes,{limitInputPixels:25_000_000,failOn:"warning",animated:false})
  .rotate().resize({width:384,height:384,fit:"inside",withoutEnlargement:true}).webp({quality:75}).toBuffer();
}
