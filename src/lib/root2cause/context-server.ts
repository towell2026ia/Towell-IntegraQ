import "server-only";
import {createHash} from "node:crypto";
import {createClient} from "@/lib/supabase/server";
import {canAccessProcess,isExternalUser,type ActiveSession} from "@/lib/session-data";
import {relevantExcerpts} from "./assistant";
import type {AiDocumentReference} from "@/lib/types";
export async function retrieveRootCauseDocuments(session:ActiveSession,processId:string,query:string) {
 if(!session.authUserId||isExternalUser(session)||!canAccessProcess(session,processId))throw new Error("Proceso no autorizado.");
 // User-scoped client: never service_role. RLS also applies to file downloads.
 const db=await createClient();
 const actor=await db.from("profiles").select("organization_id,status").eq("id",session.authUserId!).single();
 if(actor.error||actor.data?.status!=="active"||!actor.data.organization_id)throw new Error("Organización no verificable.");
 const versions=await db.from("controlled_document_versions").select("id,document_id,revision,file_id,authorized_at,document:controlled_documents!inner(id,code,title,description,document_type_id,process_id,organization_id,active,deleted_at)").eq("status","current").not("authorized_at","is",null).eq("document.active",true).is("document.deleted_at",null).eq("document.organization_id",actor.data.organization_id).eq("document.process_id",processId).order("authorized_at",{ascending:false}).limit(40);
 if(versions.error)throw new Error("No se pudo recuperar la documentación vigente autorizada.");
 const documents:AiDocumentReference[]=[];const warnings:string[]=[];
 let bytesRead=0;
 for(const v of (versions.data??[]).slice(0,8)){
  const d=(Array.isArray(v.document)?v.document[0]:v.document) as unknown as Record<string,unknown>;
  if(!d)continue;
  // Explicit tenant check in addition to the existing document policies.
  if(d.organization_id!==actor.data.organization_id||d.process_id!==processId||d.active!==true||d.deleted_at)continue;
  const file=await db.from("file_objects").select("id,bucket_id,object_path,mime_type,size_bytes,sha256").eq("id",v.file_id).is("deleted_at",null).maybeSingle();
  if(file.error||!file.data||file.data.bucket_id!=="integraq-private"||(!file.data.size_bytes||file.data.size_bytes>8*1024*1024||bytesRead+file.data.size_bytes>32*1024*1024)){warnings.push(`${d.code}: archivo no disponible para recuperación.`);continue;}
  const download=await db.storage.from(file.data.bucket_id).download(file.data.object_path);
  if(download.error||!download.data)continue;
  const bytes=new Uint8Array(await download.data.arrayBuffer());bytesRead+=bytes.length;
  if(bytes.length>8*1024*1024||bytes.length!==file.data.size_bytes||(file.data.sha256&&createHash("sha256").update(bytes).digest("hex")!==file.data.sha256)){warnings.push(`${d.code}: integridad no verificada.`);continue;}
  let content="";
  try{
   if(file.data.mime_type==="application/pdf"){
    if(Buffer.from(bytes.subarray(0,5)).toString()!=="%PDF-")throw new Error("Invalid PDF");
    const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading=pdfjs.getDocument({data:bytes,useSystemFonts:false});
    const pdf=await loading.promise;
    try{for(let n=1;n<=Math.min(pdf.numPages,40);n++){const page=await pdf.getPage(n);const text=await page.getTextContent();content+=text.items.map(i=>"str" in i?i.str:"").join(" ")+"\n";}}finally{await loading.destroy();}
   }else if(file.data.mime_type==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
    const mammoth=await import("mammoth");content=(await mammoth.extractRawText({buffer:Buffer.from(bytes)})).value;
   }else if(file.data.mime_type==="text/plain")content=new TextDecoder().decode(bytes);
  }catch{warnings.push(`${d.code}: no fue posible extraer texto; requiere revisión documental.`);}
  const excerpt=relevantExcerpts(content,query);
  if(!excerpt){warnings.push(`${d.code}: sin fragmentos de texto relacionados; no se utilizó como fundamento.`);continue;}
  documents.push({id:String(d.id),code:String(d.code),title:String(d.title),type:String(d.document_type_id),version:String(v.revision),excerpt});
  if(documents.length>=6)break;
 }
 if(!documents.length)warnings.push("Sin documentos vigentes legibles relacionados; no se confirmaron procedimientos ni causas.");
 return {documents,warnings};
}
