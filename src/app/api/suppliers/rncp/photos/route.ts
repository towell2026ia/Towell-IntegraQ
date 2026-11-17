import { rncpContext, RncpError } from "@/lib/rncp/server";
import { photoReport, photoManifest, photoRpcError, inspectInitialPhoto, photoObjectIdentity, photoFailure, requirePhotoV2, readPhotoUpload } from "@/lib/rncp/initial-photo-server";
import { MAX_INITIAL_PHOTO_BYTES } from "@/lib/rncp/initial-photos";
export const maxDuration=30;
export async function GET(request:Request) {
 try {
  const id=new URL(request.url).searchParams.get("reportId"),c=id?await photoReport(id):await rncpContext("update");
  if(!id)await requirePhotoV2(c);
  return Response.json(id?await photoManifest(c,id):{available:true,protocol:2},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return photoFailure(e);}
}
export async function POST(request:Request) {
 try {
  const length=Number(request.headers.get("content-length"));if(length>MAX_INITIAL_PHOTO_BYTES+65536)throw new RncpError("La fotografía supera 4 MB.",413);
  await rncpContext("update");
  const form=await readPhotoUpload(request);
  if([...form.keys()].some(key=>key!=="reportId"&&key!=="file") || form.getAll("reportId").length!==1 || form.getAll("file").length!==1)throw new RncpError("Envía únicamente el RNCP y una fotografía; su verificación corresponde al backend.");
  const id=String(form.get("reportId")??""),file=form.get("file"),c=await photoReport(id,true);
  if(!(file instanceof File)||!file.size||file.size>MAX_INITIAL_PHOTO_BYTES)throw new RncpError("Selecciona una fotografía de hasta 4 MB.");
  await requirePhotoV2(c);
  const bytes=new Uint8Array(await file.arrayBuffer()),info=await inspectInitialPhoto(bytes,file.name,file.type);
  const identity=photoObjectIdentity(c.organizationId,id,info.sha256,info.mime);
  const candidate={...identity,...info,name:file.name,size:bytes.length};
  const reserved=await c.supabase.rpc("iq_rncp_initial_photo_reserve",{p_report:id,p_file:candidate});
  photoRpcError(reserved.error);
  if(reserved.data?.id!==identity.id || reserved.data.path!==identity.path || typeof reserved.data.verified!=="boolean")throw new RncpError("La reserva no coincide con el archivo autorizado. No se inició la carga.",409);
  const storage=c.admin.storage.from("integraq-private");
  // Never overwrite. Both success and an existing/lost upload MUST be read back.
  if(!reserved.data.verified) {
   try {await storage.upload(identity.path,bytes,{contentType:info.mime,upsert:false,cacheControl:"0"});}
   catch { /* A transport error can follow a completed upload. Verify the object below. */ }
  }
  const stored=await storage.download(identity.path);
  if(stored.error||!stored.data)throw new RncpError("No se pudo leer la fotografía privada. La reserva y el borrador se conservan para reintentar.",503);
  if(stored.data.size!==bytes.length || (stored.data.type && stored.data.type!==info.mime))throw new RncpError("El tamaño o MIME del objeto privado no coincide con la reserva; no se registró.",409);
  const actualBytes=new Uint8Array(await stored.data.arrayBuffer());
  let actual:Awaited<ReturnType<typeof inspectInitialPhoto>>;
  try {actual=await inspectInitialPhoto(actualBytes,file.name,info.mime);}
  catch {throw new RncpError("El objeto privado no contiene la fotografía reservada; no se registró.",409);}
  if(actual.sha256!==info.sha256 || actual.mime!==info.mime || actual.width!==info.width || actual.height!==info.height || actualBytes.length!==candidate.size)throw new RncpError("La integridad o dimensiones del objeto privado no coinciden; no se registró.",409);
  // Derived only from bytes read by this backend, NEVER from browser attestations.
  const verified={...photoObjectIdentity(c.organizationId,id,actual.sha256,actual.mime),...actual,name:file.name,size:actualBytes.length};
  const attested=await c.admin.rpc("iq_rncp_initial_photo_attest",{p_file_id:identity.id,p_verified:verified});
  photoRpcError(attested.error);
  const staged=await c.supabase.rpc("iq_rncp_initial_photo_stage",{p_report:id,p_file:verified});
  photoRpcError(staged.error);
  if(staged.data!==identity.id)throw new RncpError("El registro no devolvió la identidad reservada. Conserva la selección para revisar.",409);
  return Response.json({id:staged.data},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return photoFailure(e);}
}
export async function PUT(request:Request) {
 try {
  const b=await request.json();if(!Array.isArray(b.fileIds)||b.fileIds.length>12||new Set(b.fileIds).size!==b.fileIds.length||b.fileIds.some((id:unknown)=>typeof id!=="string"||!/^[a-f0-9-]{36}$/i.test(id))||!Number.isSafeInteger(b.revision)||b.revision<0||typeof b.reason!=="string"||b.reason.trim().length<5||b.reason.trim().length>1000)throw new RncpError("Orden, revisión o motivo de fotografías no válidos.");
  const c=await photoReport(String(b.reportId??""),true);
  await requirePhotoV2(c);
  const r=await c.supabase.rpc("iq_rncp_initial_photo_commit",{p_report:b.reportId,p_ids:b.fileIds,p_revision:b.revision,p_reason:b.reason.trim()});photoRpcError(r.error);
  return Response.json(r.data,{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return photoFailure(e);}
}
