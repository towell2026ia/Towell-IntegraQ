import {rncpContext,RncpError} from "@/lib/rncp/server";
import {photoFailure} from "@/lib/rncp/initial-photo-server";
import {prepareInitialNotification} from "@/lib/rncp/initial-notification";
import {mailConfiguration,connectedMailbox,loginMailbox} from "@/lib/rncp/mail-auth";
import {dispatchInitialMail,reconcileInitialMail,initialMailJob} from "@/lib/rncp/mail-dispatch";
export const maxDuration=60;
export async function GET(_request:Request,{params}:{params:Promise<{reportId:string}>}){
 if(!mailConfiguration())return new Response(null,{status:404});
 try{const {reportId}=await params;if(!/^[a-f0-9-]{36}$/i.test(reportId))throw new RncpError("RNCP no válido.");
  const context=await rncpContext("update");const prepared=await prepareInitialNotification(context,reportId),config=mailConfiguration(),connected=await connectedMailbox(context),sender=await loginMailbox(context);
  let job:Awaited<ReturnType<typeof initialMailJob>>=null,activationError="";try{job=await initialMailJob(context,reportId);}catch(e){activationError=e instanceof Error?e.message:"Activación pendiente";}
  const pending=prepared.pending.filter(p=>!p.startsWith("Transporte corporativo")&&!p.startsWith("Activación individual"));
  if(!config)pending.push("Microsoft 365 pendiente de configuración y activación autorizada");else if(!connected)pending.push("Conectar el buzón de la cuenta que inició sesión");if(activationError)pending.push(activationError);if(job&&job.attempts>=5&&job.initial_phase!=="accepted")pending.push("Se agotaron cinco intentos. Requiere revisión antes de otra operación.");
  return Response.json({...prepared,sender,canConnect:Boolean(config),connected:connected?.email??null,sendEnabled:pending.length===0&&!prepared.alreadyNotified&&(!job||["prepared","failed"].includes(job.initial_phase)),pending,
   delivery:job?{phase:job.initial_phase,messageId:job.provider_message_id,acceptedAt:job.sent_at,attempts:job.attempts,error:job.last_error_code,pdfVersion:job.initial_payload.version,recipient:job.initial_payload.recipient}:null,
   note:"El remitente será tu buzón Microsoft 365; Reply-To será el contacto del creador. Aceptación técnica no significa entrega o lectura."},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return photoFailure(error);}
}
export async function POST(request:Request,{params}:{params:Promise<{reportId:string}>}){
 try{const config=mailConfiguration();if(!config)throw new RncpError("Microsoft 365 está desactivado. No se envió correo.",503);
  if(request.headers.get("origin")!==new URL(config.redirect).origin)throw new RncpError("Origen de solicitud no autorizado.",403);
  const {reportId}=await params;if(!/^[a-f0-9-]{36}$/i.test(reportId))throw new RncpError("RNCP no válido.");
  const context=await rncpContext("update"),body=await request.json().catch(()=>null) as {command?:string;confirmed?:boolean;expected?:Record<string,unknown>;reason?:string}|null;
  if(!body)throw new RncpError("Solicitud no válida.");
  if(body.command==="reconcile")return Response.json(await reconcileInitialMail(context,reportId),{headers:{"Cache-Control":"private, no-store"}});
  if(body.command!=="send"||body.confirmed!==true||!body.expected||typeof body.reason!=="string"||body.reason.trim().length<5)throw new RncpError("Confirma el envío individual, destinatario, PDF y motivo.");
  return Response.json(await dispatchInitialMail(context,reportId,{expected:body.expected,reason:body.reason.trim()}),{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return photoFailure(error);}
}
