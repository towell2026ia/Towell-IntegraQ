import "server-only";
import {loadGeneratedSnapshot} from "./generated-pdf-server";
import {RncpError,type RncpContext} from "./server";
export function verifiedMail(value:unknown){return typeof value==="string" && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? value : null;}
export async function prepareInitialNotification(c:RncpContext,id:string){
 const {snapshot:s,fingerprint}=await loadGeneratedSnapshot(c,id);
 const creator=await c.admin.from("profiles").select("id,full_name,organization_id,user_type,status")
  .eq("id",s.report.created_by).eq("organization_id",c.organizationId).maybeSingle();
 if(creator.error||!creator.data||creator.data.status!=="active"||!["administrator","internal"].includes(creator.data.user_type))throw new RncpError("El contacto del creador requiere revisión.",409);
 const auth=await c.admin.auth.admin.getUserById(creator.data.id);
 const replyTo=auth.error||!auth.data.user?.email_confirmed_at?null:verifiedMail(auth.data.user.email);
 const supplier=await c.admin.from("organizations").select("id,metadata").eq("id",s.supplier.id).eq("kind","supplier").eq("active",true).maybeSingle();
 if(supplier.error||!supplier.data)throw new RncpError("No fue posible verificar el contacto del proveedor.",503);
 const contact=supplier.data.metadata?.supplierQualityContacts as {email?:string;emailVerified?:boolean;emailVerifiedAt?:string;notificationName?:string}|undefined;
 const recipient=contact?.emailVerified===true && Number.isFinite(Date.parse(contact.emailVerifiedAt??"")) && Date.parse(contact.emailVerifiedAt??"")<=Date.now() ? verifiedMail(contact.email) : null;
 const file=await c.admin.from("file_objects").select("id,original_name,sha256,version").eq("workspace_id",c.organizationId)
  .eq("resource_type","supplier_rncp_original").eq("resource_id",id).eq("resource_key","generated:"+fingerprint).is("deleted_at",null).maybeSingle();
 if(file.error)throw new RncpError("No se pudo comprobar el PDF oficial vigente.",503);
 return {status:"pending_configuration" as const,sendEnabled:false,notified:false,
  replyTo:replyTo?{name:creator.data.full_name,email:replyTo}:null,
  recipient:recipient?{name:contact?.notificationName||null,email:recipient}:null,pdf:file.data,
  fingerprint,reportId:id,
  alreadyNotified:Boolean((s.report as unknown as {notified_at?:string}).notified_at),
  pending:[...(!replyTo?["Contacto confirmado del creador"]:[]),...(!recipient?["Destinatario del proveedor verificado manualmente"]:[]),...(!file.data?["PDF oficial de la revisión actual"]:[]),
   "Transporte corporativo autorizado, con idempotencia y consulta de aceptación", "Activación individual revisada de envío y registro transaccional del resultado"],
  note:"El contacto del creador se utilizará para respuestas. No equivale a autorizar el envío desde su buzón. No se envió correo ni se inició el plazo."};
}
