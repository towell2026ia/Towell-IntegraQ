import "server-only";
import {createHash} from "node:crypto";
import {graphIdentity,type MailSession} from "./mail-auth";
const base="https://graph.microsoft.com/v1.0";
const property="String {993d83d1-5713-4a5a-b7e1-f9ca2af519ae} Name IntegraQRncpKey";
export interface InitialMailPacket{actorId:string;sender:string;recipient:string;replyTo:string;fileId:string;sha256:string;size:number;version:number;name:string;path:string;bucket:string;snapshot:string;folio:string;provider:"microsoft-graph";}
export class MailTransportError extends Error{constructor(public code:string,public uncertain:boolean){super(uncertain?"No se confirmó la aceptación. Consulta el resultado antes de reintentar.":"Microsoft 365 rechazó la operación. El RNCP permanece pendiente de notificación.");}}
interface Message{from?:{emailAddress:{address:string}};sender?:{emailAddress:{address:string}};id:string;isDraft:boolean;sentDateTime?:string;toRecipients?:Array<{emailAddress:{address:string}}>;ccRecipients?:unknown[];bccRecipients?:unknown[];replyTo?:Array<{emailAddress:{address:string}}>;subject?:string;}
export function graphMailTransport(session:MailSession,request:typeof fetch=fetch){
 async function api(path:string,init:RequestInit={}){let r:Response;try{r=await request(base+path,{...init,headers:{Authorization:`Bearer ${session.accessToken}`,Prefer:'IdType="ImmutableId"',"Content-Type":"application/json",...init.headers},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});}catch{throw new MailTransportError("CONNECTION",true);}
  if(!r.ok)throw new MailTransportError(r.status===401||r.status===403?"AUTHENTICATION":"PROVIDER_FAILURE",r.status>=500||r.status===408);return r;}
 async function find(key:string){if(!/^[a-f0-9-]{36}$/i.test(key))throw new MailTransportError("CONFIGURATION",false);
  const query=new URLSearchParams({"$filter":`singleValueExtendedProperties/Any(ep: ep/id eq '${property}' and ep/value eq '${key}')`,"$select":"id,isDraft,sentDateTime,from,sender,toRecipients,ccRecipients,bccRecipients,replyTo,subject","$top":"2"});
  const data=await(await api("/me/messages?"+query)).json() as {value:Message[]};if(!Array.isArray(data.value)||data.value.length>1)throw new MailTransportError("UNCERTAIN",true);return data.value[0]??null;}
 async function verify(message:Message,p:InitialMailPacket){
  const same=(list:Message["toRecipients"],email:string)=>list?.length===1&&list[0].emailAddress.address.toLowerCase()===email.toLowerCase();
  if((message.from?.emailAddress.address && message.from.emailAddress.address.toLowerCase()!==p.sender.toLowerCase()) || (message.sender?.emailAddress.address && message.sender.emailAddress.address.toLowerCase()!==p.sender.toLowerCase()) || (!message.isDraft && !message.from?.emailAddress.address))throw new MailTransportError("DOCUMENT_MISMATCH",true);
  if(!same(message.toRecipients,p.recipient)||!same(message.replyTo,p.replyTo)||message.ccRecipients?.length||message.bccRecipients?.length||message.subject!==`RNCP ${p.folio} · F-CA-25`)throw new MailTransportError("DOCUMENT_MISMATCH",true);
  const result=await(await api(`/me/messages/${encodeURIComponent(message.id)}/attachments?$select=id,name,contentType,size,isInline`)).json() as {value:Array<{id:string;name:string;contentType:string;size:number;isInline:boolean}>};
  if(result.value?.length!==1||result.value[0].name!==p.name||result.value[0].isInline||result.value[0].contentType!=="application/pdf")throw new MailTransportError("DOCUMENT_MISMATCH",true);
  const content=new Uint8Array(await(await api(`/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(result.value[0].id)}/$value`)).arrayBuffer());
  if(content.length!==p.size||createHash("sha256").update(content).digest("hex")!==p.sha256)throw new MailTransportError("DOCUMENT_MISMATCH",true);
 }
 async function acceptance(key:string,p:InitialMailPacket){try{await graphIdentity(session.accessToken,p.sender);}catch{throw new MailTransportError("AUTHENTICATION",false);}const found=await find(key);if(!found)return null;await verify(found,p);return !found.isDraft&&found.sentDateTime?{messageId:found.id,acceptedAt:found.sentDateTime}:null;}
 async function send(key:string,p:InitialMailPacket,bytes:Uint8Array,remember:(id:string)=>Promise<void>){
  if(session.email.toLowerCase()!==p.sender.toLowerCase())throw new MailTransportError("AUTHENTICATION",false);
  try{await graphIdentity(session.accessToken,p.sender);}catch{throw new MailTransportError("AUTHENTICATION",false);}
  if(bytes.length!==p.size||createHash("sha256").update(bytes).digest("hex")!==p.sha256)throw new MailTransportError("DOCUMENT_MISMATCH",false);
  let draft=await find(key);
  if(!draft){draft=await(await api("/me/messages",{method:"POST",body:JSON.stringify({subject:`RNCP ${p.folio} · F-CA-25`,body:{contentType:"Text",content:`Se adjunta el reporte ${p.folio}, versión documental ${p.version}. Para su seguimiento, utilice IntegraQ. Las respuestas se dirigirán al contacto del creador.`},toRecipients:[{emailAddress:{address:p.recipient}}],replyTo:[{emailAddress:{address:p.replyTo}}],singleValueExtendedProperties:[{id:property,value:key}]})})).json() as Message;
   if(!draft.id)throw new MailTransportError("UNCERTAIN",true);await remember(draft.id);
  }
  if(draft.isDraft){
   const existingAttachments=await(await api(`/me/messages/${encodeURIComponent(draft.id)}/attachments?$select=id`)).json() as {value:Array<{id:string}>};
   if(!Array.isArray(existingAttachments.value))throw new MailTransportError("UNCERTAIN",true);
   if(existingAttachments.value.length===0){
   if(bytes.length<3_000_000){await api(`/me/messages/${encodeURIComponent(draft.id)}/attachments`,{method:"POST",body:JSON.stringify({"@odata.type":"#microsoft.graph.fileAttachment",name:p.name,contentType:"application/pdf",contentBytes:Buffer.from(bytes).toString("base64")})});}
   else{const sessionData=await(await api(`/me/messages/${encodeURIComponent(draft.id)}/attachments/createUploadSession`,{method:"POST",body:JSON.stringify({AttachmentItem:{attachmentType:"file",name:p.name,size:bytes.length,contentType:"application/pdf"}})})).json() as {uploadUrl:string};
    const u=new URL(sessionData.uploadUrl);if(u.protocol!=="https:"||u.username||u.password||!["outlook.office.com","outlook.office365.com","graph.microsoft.com"].includes(u.hostname))throw new MailTransportError("CONFIGURATION",true);
    for(let offset=0;offset<bytes.length;offset+=320*1024){const chunk=bytes.slice(offset,Math.min(offset+320*1024,bytes.length));let uploaded:Response;try{uploaded=await request(u,{method:"PUT",headers:{"Content-Type":"application/octet-stream","Content-Length":String(chunk.length),"Content-Range":`bytes ${offset}-${offset+chunk.length-1}/${bytes.length}`},body:chunk.buffer,redirect:"error",signal:AbortSignal.timeout(20000)});}catch{throw new MailTransportError("CONNECTION",true);}if(!uploaded.ok)throw new MailTransportError("PROVIDER_FAILURE",true);}
   }
   }
   draft=await(await api(`/me/messages/${encodeURIComponent(draft.id)}?$select=id,isDraft,sentDateTime,from,sender,toRecipients,ccRecipients,bccRecipients,replyTo,subject`)).json() as Message;
  }
  await remember(draft.id);await verify(draft,p);
  if(!draft.isDraft){if(!draft.sentDateTime)throw new MailTransportError("UNCERTAIN",true);return {messageId:draft.id,acceptedAt:draft.sentDateTime};}
  const sent=await api(`/me/messages/${encodeURIComponent(draft.id)}/send`,{method:"POST"});if(sent.status!==202)throw new MailTransportError("UNCERTAIN",true);
  return {messageId:draft.id,acceptedAt:new Date().toISOString()};
 }
 return {send,acceptance};
}
