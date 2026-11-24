import "server-only";
import {createHash} from "node:crypto";
import {createClient} from "@/lib/supabase/server";
import {canAccessProcess,isExternalUser,type ActiveSession} from "@/lib/session-data";
import {relevantExcerpts} from "./assistant";
import type {AiDocumentReference} from "@/lib/types";
export async function retrieveRootCauseDocuments(session:ActiveSession,processId:string,query:string,evidenceScope?:{evidenceId?:string;planIds?:string[]}, options?:{stage:boolean;signal:AbortSignal}) {
 if(!session.authUserId||isExternalUser(session)||!canAccessProcess(session,processId))throw new Error("Proceso no autorizado.");
 // User-scoped client: never service_role. RLS also applies to file downloads.
 const db=await createClient();
 const actor=await db.from("profiles").select("organization_id,status").eq("id",session.authUserId!).single();
 if(actor.error||actor.data?.status!=="active"||!actor.data.organization_id)throw new Error("Organización no verificable.");
 const stage=options?.stage === true;
 const maxFiles=stage ? 3 : 6;
 const versions=await db.from("controlled_document_versions").select("id,document_id,revision,file_id,authorized_at,document:controlled_documents!inner(id,code,title,description,document_type_id,process_id,organization_id,active,deleted_at)").eq("status","current").not("authorized_at","is",null).eq("document.active",true).is("document.deleted_at",null).eq("document.organization_id",actor.data.organization_id).eq("document.process_id",processId).order("authorized_at",{ascending:false}).limit(maxFiles);
 if(versions.error)throw new Error("No se pudo recuperar la documentación vigente autorizada.");
 const documents:AiDocumentReference[]=[];const warnings:string[]=[];
 let bytesRead=0;
 for(const v of (versions.data??[]).slice(0,maxFiles)){
  options?.signal.throwIfAborted();
  const d=(Array.isArray(v.document)?v.document[0]:v.document) as unknown as Record<string,unknown>;
  if(!d)continue;
  // Explicit tenant check in addition to the existing document policies.
  if(d.organization_id!==actor.data.organization_id||d.process_id!==processId||d.active!==true||d.deleted_at)continue;
  const file=await db.from("file_objects").select("id,bucket_id,object_path,mime_type,size_bytes,sha256").eq("id",v.file_id).is("deleted_at",null).maybeSingle();
  if(file.error||!file.data||file.data.bucket_id!=="integraq-private"||(!file.data.size_bytes||file.data.size_bytes>8*1024*1024||bytesRead+file.data.size_bytes>(stage?8:16)*1024*1024)){warnings.push(`${d.code}: archivo no disponible para recuperación.`);continue;}
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
    try{for(let n=1;n<=Math.min(pdf.numPages,stage?8:20);n++){options?.signal.throwIfAborted();const page=await pdf.getPage(n);const text=await page.getTextContent();content+=text.items.map(i=>"str" in i?i.str:"").join(" ")+"\n";}}finally{await loading.destroy();}
   }else if(file.data.mime_type==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
    const mammoth=await import("mammoth");content=(await mammoth.extractRawText({buffer:Buffer.from(bytes)})).value;
   }else if(file.data.mime_type==="text/plain")content=new TextDecoder().decode(bytes);
  }catch{warnings.push(`${d.code}: no fue posible extraer texto; requiere revisión documental.`);}
  const excerpt=relevantExcerpts(content,query);
  if(!excerpt){warnings.push(`${d.code}: sin fragmentos de texto relacionados; no se utilizó como fundamento.`);continue;}
  documents.push({id:String(d.id),code:String(d.code),title:String(d.title),type:String(d.document_type_id),version:String(v.revision),excerpt});
  if(documents.length>=(stage?2:4))break;
 }
 options?.signal.throwIfAborted();
 if(evidenceScope?.evidenceId){
  const evidence=await retrieveRootCauseEvidence(db,session,processId,query,{evidenceId:evidenceScope.evidenceId,planIds:evidenceScope.planIds},String(actor.data.organization_id));
  documents.push(...evidence.documents);
  warnings.push(...evidence.warnings);
 }
 if(!documents.length)warnings.push("Sin documentos vigentes legibles relacionados; no se confirmaron procedimientos ni causas.");
 return {documents,warnings};
}

async function retrieveRootCauseEvidence(db:Awaited<ReturnType<typeof createClient>>,session:ActiveSession,processId:string,query:string,scope:{evidenceId:string;planIds?:string[]},organizationId:string) {
 const documents:AiDocumentReference[]=[];const warnings:string[]=[];
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!session.authUserId||!uuid.test(scope.evidenceId)){warnings.push("El identificador de evidencias del expediente no es válido; no se consultaron adjuntos.");return{documents,warnings};}
 const keys=[...Array.from({length:8},(_,step)=>`${scope.evidenceId}_step_${step}`),...(scope.planIds??[]).filter(id=>uuid.test(id)).map(id=>`${scope.evidenceId}_plan_${id}`)];
 let remainingBytes=12*1024*1024;
 for(const key of keys){
  if(documents.length>=2)break;
  const access=await db.rpc("iq_root2cause_evidence_access",{p_key:key,p_process:processId,p_write:false,p_uploader:session.authUserId});
  if(access.error||access.data!==true)continue;
  const result=await db.from("file_objects").select("id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,uploaded_by,process_id,workspace_id,resource_key,version")
   .eq("module_id","corrective-actions").eq("resource_type","root2cause_evidence").eq("resource_key",key).eq("process_id",processId).eq("audience","internal").eq("bucket_id","integraq-private").eq("is_current",true).is("deleted_at",null).order("created_at",{ascending:false}).limit(8);
  if(result.error){warnings.push("No fue posible verificar todos los adjuntos Root2Cause; esos archivos no se enviaron al asistente.");continue;}
  for(const row of (result.data??[]) as Array<Record<string,unknown>>){
   const size=Number(row.size_bytes??0),path=String(row.object_path??""),uploader=String(row.uploaded_by??""),mime=String(row.mime_type??"");
   if(row.bucket_id!=="integraq-private"||row.workspace_id!==organizationId||row.process_id!==processId||row.resource_key!==key||!uploader||!path.startsWith(`${uploader}/attachments/corrective-actions/root2cause_evidence/${key}/`)||!Number.isFinite(size)||size<1||size>8*1024*1024||size>remainingBytes||! /^[a-f0-9]{64}$/i.test(String(row.sha256??""))){
    warnings.push(`${String(row.original_name??"Adjunto")}: no se verificaron metadatos, organización o integridad; no se utilizó como fuente.`);continue;
   }
   const isTextual=mime==="application/pdf"||mime==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"||mime==="text/plain";
   if(!isTextual){warnings.push(`${String(row.original_name??"Evidencia")}: el archivo no textual no se envió a OpenAI; requiere revisión humana.`);continue;}
   const downloaded=await db.storage.from("integraq-private").download(path);
   if(downloaded.error||!downloaded.data){warnings.push(`${String(row.original_name??"Adjunto")}: no se pudo leer desde Storage privado.`);continue;}
   const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
   if(bytes.length!==size||bytes.length>8*1024*1024||createHash("sha256").update(bytes).digest("hex")!==String(row.sha256).toLowerCase()){
    warnings.push(`${String(row.original_name??"Adjunto")}: el SHA-256 o el tamaño no coincide; no se utilizó.`);continue;
   }
   remainingBytes-=bytes.length;
   let content="";
   try{
    if(mime==="application/pdf"){
     if(Buffer.from(bytes.subarray(0,5)).toString()!=="%PDF-")throw new Error("Firma PDF inválida");
     const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");const loading=pdfjs.getDocument({data:bytes,useSystemFonts:false});const pdf=await loading.promise;
     try{for(let pageNumber=1;pageNumber<=Math.min(pdf.numPages,30);pageNumber++){const page=await pdf.getPage(pageNumber);const text=await page.getTextContent();content+=text.items.map(item=>"str" in item?item.str:"").join(" ")+"\n";}}finally{await loading.destroy();}
    }else if(mime==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
     if(Buffer.from(bytes.subarray(0,2)).toString()!=="PK")throw new Error("Firma DOCX inválida");
     const mammoth=await import("mammoth");content=(await mammoth.extractRawText({buffer:Buffer.from(bytes)})).value;
    }else content=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
   }catch{warnings.push(`${String(row.original_name??"Adjunto")}: no se pudo extraer contenido verificable.`);continue;}
   const excerpt=relevantExcerpts(content,query,4000);
   if(!excerpt){warnings.push(`${String(row.original_name??"Adjunto")}: no se encontró un fragmento textual relacionado; no se citó.`);continue;}
   documents.push({id:String(row.id),code:"EVIDENCIA",title:String(row.original_name??"Evidencia Root2Cause"),type:"root2cause_evidence",version:String(row.version??1),excerpt});
   if(documents.length>=2)break;
  }
 }
 return{documents,warnings};
}
