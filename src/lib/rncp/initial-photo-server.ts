import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { rncpContext, RncpError, type RncpContext } from "./server";
import { INITIAL_PHOTO_RESOURCE, MAX_INITIAL_PHOTO_PIXELS, MAX_INITIAL_PHOTO_BYTES, validatePhotoEnvelope, validatePhotoDimensions, type InitialPhotoManifest } from "./initial-photos";
export function photoRpcError(error: {code?:string;message?:string}|null) {
 if (!error) return;
 const message=error.message??"";
 if (["PGRST202","42P01","42883","42703"].includes(error.code??"")) throw new RncpError("Fotografías pendientes de activación: se requiere el contrato SQL V2 completo.",503);
 if (message.includes("PHOTO_REPORT_PREPARED_QUOTA")) throw new RncpError("Se agotó la cuota de fotografías preparadas de este RNCP (24 archivos o 48 MiB). Los archivos conservados no se eliminan; solicita revisión de capacidad.",409);
 if (message.includes("PHOTO_ORG_PREPARED_QUOTA")) throw new RncpError("Se agotó la cuota de fotografías preparadas de la organización (240 archivos o 480 MiB). Solicita revisión de capacidad; no se eliminaron documentos.",409);
 if (message.includes("PHOTO_CONFLICT")) throw new RncpError("La revisión de fotografías cambió. Consulta la versión guardada y concilia antes de volver a guardar.",409);
 if (message.includes("PHOTO_REQUEST_REUSED_WITH_DIFFERENT_PAYLOAD")) throw new RncpError("La solicitud inicial ya fue procesada con otros datos. Abre el borrador guardado; no se sobrescribió su contenido.",409);
 if (message.includes("PHOTO_DRAFT_LOCKED")) throw new RncpError("El RNCP ya no es un borrador editable. Sus fotografías se conservan sin cambios.",409);
 if (error.code==="42501") throw new RncpError("No tienes acceso o falta la verificación del backend para las fotografías de este RNCP.",403);
 if (/PHOTO_(?:VERIFICATION|IDENTITY|OBJECT_UNVERIFIED|UNRESERVED)/.test(message)) throw new RncpError("No coincide la reserva o la integridad de la fotografía privada. No se registró; conserva el archivo y solicita revisión.",409);
 throw new RncpError("No se guardaron las fotografías. Conserva la selección para reintentar; no se eliminaron archivos.",409);
}

// Readiness probes intentionally use NULL identities: V2 rejects BEFORE writes/locks.
// No successful/missing/unexpected response may enable the legacy upload protocol.
export async function requirePhotoV2(context:Pick<RncpContext,"supabase"|"admin">) {
 if (process.env.RNCP_FLOW_ENABLED !== "true") throw new RncpError("Las fotografías iniciales están pendientes de activación.",503);
 const reserve=await context.supabase.rpc("iq_rncp_initial_photo_reserve",{p_report:null,p_file:null});
 if(reserve.error?.code!=="42501" || reserve.error.message!=="PHOTO_FORBIDDEN") {
  if(reserve.error)photoRpcError(reserve.error);
  throw new RncpError("El protocolo de reserva SQL V2 no está disponible; no se cargaron archivos.",503);
 }
 const attest=await context.admin.rpc("iq_rncp_initial_photo_attest",{p_file_id:null,p_verified:null});
 if(attest.error?.code!=="P0001" || attest.error.message!=="PHOTO_VERIFICATION_MISMATCH") {
  if(attest.error)photoRpcError(attest.error);
  throw new RncpError("La verificación privilegiada SQL V2 no está disponible; no se cargaron archivos.",503);
 }
}
// Bound multipart bytes even when Content-Length is missing or false.
export async function readPhotoUpload(request:Request) {
 const limit=MAX_INITIAL_PHOTO_BYTES+65536,reader=request.body?.getReader();
 if(!reader)throw new RncpError("Selecciona una fotografía.");
 const chunks:Uint8Array[]=[];let length=0;
 try {
  while(true){const result=await reader.read();if(result.done)break;length+=result.value.byteLength;
   if(length>limit){try{await reader.cancel();}catch{}throw new RncpError("La solicitud supera el límite de una fotografía de 4 MiB.",413);}
   chunks.push(result.value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return await new Response(bytes.buffer,{headers:{"Content-Type":request.headers.get("Content-Type")??""}}).formData();}
 catch{throw new RncpError("Solicitud de fotografía incompleta o formato multipart no válido.");}
}
export async function photoReport(reportId:string,edit=false) {
 if (!/^[a-f0-9-]{36}$/i.test(reportId)) throw new RncpError("RNCP no válido.");
 const context=await rncpContext(edit?"update":"view");
 if(context.session?.specificPermissions?.["rncp.consultar_expedientes"]===false || edit && context.session?.specificPermissions?.["rncp.revisar_evidencias"]===false) throw new RncpError("Evidencia fuera de las facultades autorizadas.",403);
 const r=await context.supabase.from("supplier_rncp_reports").select("id,organization_id,supplier_id,folio,status,source_kind,deleted_at,notified_at").eq("id",reportId).eq("organization_id",context.organizationId).maybeSingle();
 if (r.error || !r.data || r.data.id!==reportId || r.data.organization_id!==context.organizationId || r.data.deleted_at || r.data.source_kind!=="native") throw new RncpError("Fotografías iniciales disponibles únicamente en RNCP nativos autorizados.",403);
 if (edit && (r.data.status!=="draft" || r.data.notified_at)) throw new RncpError("Las fotografías iniciales quedan conservadas después del registro. No se modifican desde una corrección.",409);
 return {...context,report:r.data};
}
export async function photoManifest(context:RncpContext,reportId:string|null) {
 const r=await context.supabase.rpc("iq_rncp_initial_photo_manifest",{p_report:reportId});
 photoRpcError(r.error);
 if(reportId!==null && (!r.data || !Number.isSafeInteger(r.data.revision) || r.data.revision<0 || !Array.isArray(r.data.files))) throw new RncpError("El manifiesto privado recibido no es válido.",503);
 return r.data as InitialPhotoManifest;
}
export async function inspectInitialPhoto(bytes:Uint8Array,name:string,declared:string) {
 let mime:string;try{mime=validatePhotoEnvelope(name,bytes.length,bytes,declared);}catch(e){throw new RncpError(e instanceof Error?e.message:"Fotografía no válida.");}
 try {
  const image=sharp(bytes,{limitInputPixels:MAX_INITIAL_PHOTO_PIXELS,failOn:"warning",animated:false});
  const m=await image.metadata();validatePhotoDimensions(m.width??0,m.height??0,m.pages??1);
  const expected=m.format==="jpeg"?"image/jpeg":m.format==="png"?"image/png":m.format==="webp"?"image/webp":null;
  if (expected!==mime) throw new Error("Formato inconsistente.");
  await image.rotate().resize({width:64,height:64,fit:"inside",withoutEnlargement:true}).raw().toBuffer();
  return {mime,width:m.autoOrient?.width??m.width!,height:m.autoOrient?.height??m.height!,sha256:createHash("sha256").update(bytes).digest("hex")};
 } catch { throw new RncpError("El archivo no contiene una fotografía completa, legible y compatible."); }
}
export function photoObjectIdentity(org:string,reportId:string,sha:string,mime:string) {
 const hex=createHash("sha256").update(org+":"+reportId+":"+sha).digest("hex");
 const id=hex.slice(0,8)+"-"+hex.slice(8,12)+"-5"+hex.slice(13,16)+"-a"+hex.slice(17,20)+"-"+hex.slice(20,32);
 return {id,path:"rncp-initial/"+org+"/"+reportId+"/"+sha+(mime==="image/png"?".png":mime==="image/webp"?".webp":".jpg")};
}
export function photoFailure(e:unknown) { return Response.json({error:e instanceof RncpError?e.message:"La operación se interrumpió. Conserva la selección y reintenta; no se eliminaron archivos."},{status:e instanceof RncpError?e.status:503,headers:{"Cache-Control":"private, no-store"}}); }
export { INITIAL_PHOTO_RESOURCE };
