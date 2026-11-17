import { privatePhotoThumbnail } from "@/lib/images/thumbnail-server";
import { createHash } from "node:crypto";
import { photoObjectIdentity,photoReport,photoManifest,photoFailure,INITIAL_PHOTO_RESOURCE } from "@/lib/rncp/initial-photo-server";
import { RncpError } from "@/lib/rncp/server";
export async function GET(request:Request,{params}:{params:Promise<{fileId:string}>}) {
 try {
  const url=new URL(request.url),variant=url.searchParams.get("variant");
  if(variant!==null&&variant!=="thumbnail")throw new RncpError("Variante de fotografía no válida.");
  const {fileId}=await params,id=url.searchParams.get("reportId")??"",c=await photoReport(id);
  const manifest=await photoManifest(c,id),photo=manifest.files.find(f=>f.id===fileId);
  if(!photo)throw new RncpError("Fotografía no vinculada al RNCP autorizado.",403);
  const f=await c.admin.from("file_objects").select("object_path,bucket_id").eq("id",fileId).eq("resource_id",id).eq("resource_type",INITIAL_PHOTO_RESOURCE).eq("workspace_id",c.organizationId).is("deleted_at",null).maybeSingle();
  if(f.error||!f.data||f.data.bucket_id!=="integraq-private"||f.data.object_path!==photoObjectIdentity(c.organizationId,id,photo.sha256,photo.mime).path)throw new RncpError("Archivo privado no autorizado.",403);
  const blob=await c.admin.storage.from("integraq-private").download(f.data.object_path);if(blob.error||!blob.data)throw new RncpError("Fotografía no disponible.",503);
  const bytes=new Uint8Array(await blob.data.arrayBuffer());
  if(!["image/png","image/jpeg","image/webp"].includes(photo.mime)||createHash("sha256").update(bytes).digest("hex")!==photo.sha256)throw new RncpError("No coincide la integridad de la fotografía privada.",409);
  const output=variant==="thumbnail"?new Uint8Array(await privatePhotoThumbnail(bytes)):bytes;
  return new Response(output.buffer,{headers:{"Content-Type":variant==="thumbnail"?"image/webp":photo.mime,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"}});
 }catch(e){return photoFailure(e);}
}
