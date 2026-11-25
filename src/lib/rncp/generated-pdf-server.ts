import "server-only";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {buildRncpPdf, type RncpPdfInput} from "./generated-pdf";
import {photoObjectIdentity, inspectInitialPhoto, INITIAL_PHOTO_RESOURCE} from "./initial-photo-server";
import {isRncpClassification} from "./flow";
import {requireRncpFlow} from "./flow-server";
import {RncpError, type RncpContext} from "./server";
import type {InitialPhotoManifest} from "./initial-photos";
export interface GeneratedSnapshot {
 fingerprint:string; snapshot:{report:{id:string;folio:string;organization_id:string;source_kind:string;supplier_id:string;
  classification:string;report_date:string|null;material_or_service:string|null;finding_type:string|null;
  rejected_quantity:number|null;description:string|null;immediate_disposition:string|null;responsible_name:string|null;
  status:string;updated_at:string;created_by:string;deleted_at:string|null};
  supplier:{id:string;name:string;code:string};site:{name:string}|null;photos:InitialPhotoManifest;actions:RncpPdfInput["actions"]};
}
export async function loadGeneratedSnapshot(c:RncpContext,id:string):Promise<GeneratedSnapshot>{
 await requireRncpFlow(c);
 const result=await c.supabase.rpc("iq_rncp_pdf_snapshot",{p_report:id});
 if(result.error)throw new RncpError(result.error.message.includes("FOLIO_REVIEW")?"El folio previo necesita regularización autorizada. No se cambió ni se generó un PDF oficial.":"No se pudo preparar la versión documental. Verifica permisos, clasificación y contrato SQL.",409);
 const data=result.data as GeneratedSnapshot; const r=data?.snapshot?.report;
 if(!r||r.id!==id||r.organization_id!==c.organizationId||r.source_kind!=="native"||r.deleted_at||!/^RNCP[0-9]+$/.test(r.folio)||!isRncpClassification(r.classification)||data.snapshot.supplier?.id!==r.supplier_id||!/^[a-f0-9]{64}$/.test(data.fingerprint)) throw new RncpError("Identidad documental no verificable.",403);
 if(!Array.isArray(data.snapshot.photos?.files)||data.snapshot.photos.files.length>12)throw new RncpError("Manifiesto de fotografías no válido.",409);
 return data;
}
export async function persistGeneratedPdf(c:RncpContext,id:string){
 const {snapshot:s,fingerprint}=await loadGeneratedSnapshot(c,id),r=s.report;
 if(r.status==="draft")throw new RncpError("Registra el reporte antes de emitir su PDF oficial.",409);
 const existing=await c.admin.from("file_objects").select("id,version,object_path,sha256,bucket_id")
  .eq("workspace_id",c.organizationId).eq("resource_type","supplier_rncp_original").eq("resource_id",id).eq("resource_key","generated:"+fingerprint).is("deleted_at",null).maybeSingle();
 if(existing.error)throw new RncpError("No se pudo comprobar la versión existente.",503);
 if(existing.data){
  if(existing.data.bucket_id!=="integraq-private"||!existing.data.object_path.startsWith("rncp-originals/"+c.organizationId+"/"))throw new RncpError("Versión fuera del expediente autorizado.",403);
  const saved=await c.admin.storage.from("integraq-private").download(existing.data.object_path);
  if(saved.error||!saved.data||createHash("sha256").update(new Uint8Array(await saved.data.arrayBuffer())).digest("hex")!==existing.data.sha256)throw new RncpError("La versión registrada requiere revisión de integridad; no se sobrescribió.",409);
  const confirmed=await c.supabase.rpc("iq_rncp_register_generated_pdf",{p_report:id,p_fingerprint:fingerprint,p_file:{id:existing.data.id,sha256:existing.data.sha256,sizeBytes:saved.data.size}});
  if(confirmed.error||confirmed.data?.fileId!==existing.data.id)throw new RncpError("El expediente cambió durante la consulta. Recarga para generar su versión actual.",409);
  return {fileId:existing.data.id,version:existing.data.version,state:"existing"};
 }
 const photos:RncpPdfInput["photos"]=[];
 for(const p of s.photos.files){
  const identity=photoObjectIdentity(c.organizationId,id,p.sha256,p.mime);
  const metadata=await c.admin.from("file_objects").select("object_path,bucket_id").eq("workspace_id",c.organizationId).eq("resource_id",id).eq("resource_type",INITIAL_PHOTO_RESOURCE).eq("id",p.id).is("deleted_at",null).maybeSingle();
  if(metadata.error||metadata.data?.bucket_id!=="integraq-private"||metadata.data.object_path!==identity.path)throw new RncpError("Fotografía fuera del manifiesto autorizado.",403);
  const photo=await c.admin.storage.from("integraq-private").download(identity.path);
  if(photo.error||!photo.data)throw new RncpError("No se pudo leer una fotografía; no se generó un documento incompleto.",503);
  const bytes=new Uint8Array(await photo.data.arrayBuffer()),checked=await inspectInitialPhoto(bytes,p.name,p.mime);
  if(checked.sha256!==p.sha256||bytes.length!==p.size||checked.width!==p.width||checked.height!==p.height)throw new RncpError("La integridad de una fotografía no coincide.",409);
  // Lossless PDF rendering only; stored originals and compression settings are untouched.
  const png=await sharp(bytes,{limitInputPixels:25_000_000}).rotate().png().toBuffer();
  photos.push({name:p.name,dataUrl:"data:image/png;base64,"+png.toString("base64"),width:p.width,height:p.height});
 }
 const logo=await readFile(path.join(process.cwd(),"public/brand/towell-logo.jpg"));
 const rendered=await buildRncpPdf({folio:r.folio,status:r.status,supplierName:s.supplier.name,supplierCode:s.supplier.code,siteName:s.site?.name,
  documentId:fingerprint.slice(0,32),documentDate:r.updated_at,photos,actions:s.actions,
  values:{classification:isRncpClassification(r.classification)?r.classification:undefined,reportDate:r.report_date??undefined,
    materialOrService:r.material_or_service??undefined,findingType:r.finding_type??undefined,rejectedQuantity:r.rejected_quantity?.toString(),
    description:r.description??undefined,immediateDisposition:r.immediate_disposition??undefined,responsibleName:r.responsible_name??undefined}},"data:image/jpeg;base64,"+logo.toString("base64"));
 if(rendered.bytes.length>4*1024*1024)throw new RncpError("El PDF supera la política vigente de 4 MiB. Se conservaron todas las fotografías; requiere revisión del límite documental.",413);
 let bytes=rendered.bytes; const objectPath=`rncp-originals/${c.organizationId}/${c.profile.id}/generated/${id}/${fingerprint}.pdf`;
 const hex=createHash("sha256").update(objectPath).digest("hex"),fileId=`${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
 let sha=createHash("sha256").update(bytes).digest("hex");
 const uploaded=await c.admin.storage.from("integraq-private").upload(objectPath,bytes,{contentType:"application/pdf",upsert:false,
  metadata:{rncpSnapshot:fingerprint,sha256:sha,fileId,actorId:c.profile.id}});
 if(uploaded.error){
  // The prior request may have uploaded successfully and lost its response. Never overwrite.
  const prior=await c.admin.storage.from("integraq-private").download(objectPath);
  if(prior.error||!prior.data)throw new RncpError("No se confirmó la carga. Reintenta este expediente; no se eliminaron archivos.",503);
  bytes=new Uint8Array(await prior.data.arrayBuffer());sha=createHash("sha256").update(bytes).digest("hex");
 }
 const registered=await c.supabase.rpc("iq_rncp_register_generated_pdf",{p_report:id,p_fingerprint:fingerprint,p_file:{id:fileId,sha256:sha,sizeBytes:bytes.length}});
 if(registered.error)throw new RncpError("El PDF permanece privado, pero su registro no se confirmó o el RNCP cambió. Recarga y reintenta; las versiones anteriores se conservan.",409);
 return registered.data as {fileId:string;version:number;state:string};
}
