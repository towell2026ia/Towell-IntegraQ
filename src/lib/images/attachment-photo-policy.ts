import type { PhotoPolicy } from "./prepare-photo";
export type AttachmentPhotoScope = "indicator-evidence" | "customer-claim" | "supplier-response";
const limits:Record<AttachmentPhotoScope,number>={"indicator-evidence":50*1024*1024,"customer-claim":4*1024*1024,"supplier-response":4*1024*1024};
/** Explicit photographic inputs only. Never apply to generic/official document uploads. */
export function attachmentPhotoPolicy(scope:AttachmentPhotoScope,fineDetail=false):PhotoPolicy {
 return {allowed:["image/jpeg","image/png","image/webp"],maxInputBytes:32*1024*1024,maxStoredBytes:limits[scope],maxInputEdge:8192,maxInputPixels:25_000_000,maxEdge:fineDetail?4096:2048,quality:fineDetail?0.92:0.8};
}
