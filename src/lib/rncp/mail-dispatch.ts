import "server-only";
import {createHash} from "node:crypto";
import {RncpError,type RncpContext} from "./server";
import {connectedMailbox,mailConfiguration} from "./mail-auth";
import {graphMailTransport,MailTransportError,type InitialMailPacket} from "./mail-graph";
export interface InitialMailJob{id:string;organization_id:string;report_id:string;lease_id:string|null;initial_phase:string;initial_payload:InitialMailPacket;initial_draft_id:string|null;provider_message_id:string|null;sent_at:string|null;attempts:number;last_error_code:string|null;}
export function mailRpcError(error:{message?:string;code?:string}|null){if(!error)return;
 const messages:Record<string,string>={RNCP_MAIL_FORBIDDEN:"Sólo Calidad autorizada puede notificar RNCP.",RNCP_MAIL_REASON_REQUIRED:"Indica el motivo del envío individual.",RNCP_MAIL_CONTACT_REQUIRED:"Falta un contacto verificado; el RNCP sigue pendiente de notificación.",RNCP_MAIL_PDF_REQUIRED:"Falta la versión oficial vigente del PDF.",RNCP_MAIL_CONFIRMATION_CHANGED:"Cambió el PDF o alguno de los contactos. Recarga y confirma nuevamente.",RNCP_MAIL_FROZEN_REVIEW_REQUIRED:"Los datos difieren del intento anterior. Requieren revisión; no se envió otro correo.",RNCP_MAIL_RECONCILE_REQUIRED:"Hay un envío en curso, incierto o con intentos agotados. Consulta su resultado; no se repetirá automáticamente.",RNCP_MAIL_NOT_PENDING:"El RNCP no está registrado pendiente de notificación.",RNCP_MAIL_SENDER_REQUIRED:"Conecta el buzón de la cuenta que inició este envío."};
 if(["PGRST202","42703","42P01"].includes(error.code??""))throw new RncpError("Envío pendiente de activación: falta el SQL específico de notificación revisado.",503);
 throw new RncpError(Object.entries(messages).find(([code])=>error.message?.includes(code))?.[1]??"No se confirmó el registro del envío. Consulta el resultado antes de reintentar.",error.code==="42501"?403:409);
}
export async function initialMailJob(c:RncpContext,reportId:string){const result=await c.supabase.from("supplier_rncp_notification_outbox").select("id,organization_id,report_id,lease_id,initial_phase,initial_payload,initial_draft_id,provider_message_id,sent_at,attempts,last_error_code").eq("organization_id",c.organizationId).eq("report_id",reportId).eq("event_type","initial").maybeSingle();mailRpcError(result.error);return result.data as InitialMailJob|null;}
function checkJob(c:RncpContext,job:InitialMailJob,id:string){if(!job||job.organization_id!==c.organizationId||job.report_id!==id||job.initial_payload?.provider!=="microsoft-graph")throw new RncpError("El envío no pertenece al expediente autorizado.",403);}
async function attest(c:RncpContext,job:InitialMailJob,result:Record<string,unknown>){const r=await c.admin.rpc("iq_rncp_attest_initial_mail",{p_id:job.id,p_lease:job.lease_id,p_result:result});mailRpcError(r.error);if(r.data!==true)throw new RncpError("No se confirmó el resultado del transporte; consulta antes de reintentar.",409);}
async function finish(c:RncpContext,job:InitialMailJob){const r=await c.supabase.rpc("iq_rncp_complete_initial_mail",{p_id:job.id});mailRpcError(r.error);return r.data as {state:string;messageId:string;acceptedAt:string};}
export async function dispatchInitialMail(c:RncpContext,reportId:string,input:{expected:Record<string,unknown>;reason:string}){
 if(!mailConfiguration())throw new RncpError("Microsoft 365 está desactivado o pendiente de configuración. No se envió correo.",503);
 const connected=await connectedMailbox(c);if(!connected)throw new RncpError("Conecta tu cuenta Microsoft 365 antes de enviar.",409);
 const prepared=await c.supabase.rpc("iq_rncp_prepare_initial_mail",{p_report:reportId,p_expected:input.expected,p_reason:input.reason});mailRpcError(prepared.error);
 const job=prepared.data as InitialMailJob;checkJob(c,job,reportId);
 if(["accepted","accepted_pending_record"].includes(job.initial_phase))return finish(c,job);
 const p=job.initial_payload;
 if(p.actorId!==c.profile.id||connected.email.toLowerCase()!==p.sender.toLowerCase())throw new RncpError("El remitente debe ser la cuenta que inició sesión y confirmó este envío.",403);
 if(!["prepared","failed"].includes(job.initial_phase))throw new RncpError("Envío en curso o incierto. Usa Consultar aceptación; no se enviará otro correo.",409);
 if(p.bucket!=="integraq-private"||!p.path.startsWith(`rncp-originals/${c.organizationId}/`)||p.size<8||p.size>4194304)throw new RncpError("Documento fuera del expediente privado.",403);
 const download=await c.admin.storage.from(p.bucket).download(p.path);if(download.error||!download.data)throw new RncpError("No se pudo leer el PDF oficial. No se intentó enviar.",503);
 const bytes=new Uint8Array(await download.data.arrayBuffer());
 if(bytes.length!==p.size||createHash("sha256").update(bytes).digest("hex")!==p.sha256||Buffer.from(bytes.subarray(0,5)).toString()!=="%PDF-")throw new RncpError("No coincide la integridad del PDF oficial. No se envió correo.",409);
 const claimed=await c.supabase.rpc("iq_rncp_claim_initial_mail",{p_report:reportId,p_expected:input.expected,p_reason:input.reason});mailRpcError(claimed.error);
 const active=claimed.data as InitialMailJob;checkJob(c,active,reportId);
 if(["accepted","accepted_pending_record"].includes(active.initial_phase))return finish(c,active);
 if(active.initial_phase!=="dispatching"||!active.lease_id||JSON.stringify(active.initial_payload)!==JSON.stringify(p))throw new RncpError("Cambió la reserva del envío. Consulta su estado.",409);
 const transport=graphMailTransport(connected);let receipt:{messageId:string;acceptedAt:string};
 try{receipt=await transport.send(active.id,p,bytes,async messageId=>attest(c,active,{outcome:"draft",messageId}));}
 catch(error){const e=error instanceof MailTransportError?error:new MailTransportError("UNCERTAIN",true);
  await attest(c,active,{outcome:e.uncertain?"unknown":"rejected",code:e.code});throw new RncpError(e.message,e.uncertain?409:502);}
 // Never re-enter transport.send if this persistence or completion response is lost.
 await attest(c,active,{outcome:"accepted",...receipt});return finish(c,active);
}
export async function reconcileInitialMail(c:RncpContext,reportId:string){const job=await initialMailJob(c,reportId);if(!job)throw new RncpError("No hay un intento de notificación para consultar.",404);checkJob(c,job,reportId);
 if(["accepted","accepted_pending_record"].includes(job.initial_phase))return finish(c,job);
 const connected=await connectedMailbox(c);if(!connected||job.initial_payload.actorId!==c.profile.id||connected.email.toLowerCase()!==job.initial_payload.sender.toLowerCase())throw new RncpError("Conecta el buzón que inició el envío para comprobar su aceptación.",403);
 const receipt=await graphMailTransport(connected).acceptance(job.id,job.initial_payload);
 if(!receipt)return {state:"pending_confirmation",message:"Microsoft 365 no acredita todavía la aceptación. No se reenvió ni se inició el plazo."};
 if(!job.lease_id)throw new RncpError("El envío requiere revisión de su reserva.",409);
 await attest(c,job,{outcome:"accepted",...receipt});return finish(c,job);
}
