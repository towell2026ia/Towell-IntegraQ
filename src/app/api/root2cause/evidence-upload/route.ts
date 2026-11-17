import {createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {NextResponse} from "next/server";
import {getAuthenticatedSession} from "@/lib/supabase/auth-session";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {isAdministrator,canAccessProcess} from "@/lib/session-data";

const bucket="integraq-private";
const keyPattern=/^[a-f0-9-]{36}_(step_[0-7]|plan_[A-Za-z0-9-]{1,64})$/;
const noStore={"Cache-Control":"no-store"};
type Ticket={user:string;org:string;key:string;process:string;path:string;issued:number};
function sign(payload:string){const secret=process.env.SUPABASE_SECRET_KEY;if(!secret)throw new Error("Missing server secret");return createHmac("sha256",secret).update("root2cause-upload-cleanup-v1:").update(payload).digest("hex");}
function encode(ticket:Ticket){const value=Buffer.from(JSON.stringify(ticket)).toString("base64url");return `${value}.${sign(value)}`;}
function decode(value:unknown):Ticket|null{
 if(typeof value!=="string"||value.length>2500)return null;
 const parts=value.split(".");if(parts.length!==2||!/^[a-f0-9]{64}$/.test(parts[1]))return null;
 const expected=Buffer.from(sign(parts[0]),"hex"),actual=Buffer.from(parts[1],"hex");
 if(!timingSafeEqual(expected,actual))return null;
 try{const t=JSON.parse(Buffer.from(parts[0],"base64url").toString()) as Ticket;
  if(!t||!Number.isFinite(t.issued)||Date.now()-t.issued>600000||Date.now()<t.issued||!keyPattern.test(t.key)||!t.path.startsWith(`${t.user}/attachments/corrective-actions/root2cause_evidence/${t.key}/`))return null;
  return t;
 }catch{return null;}
}
async function actor(){
 const s=await getAuthenticatedSession();if(!s?.authUserId||!isAdministrator(s))return null;
 const db=await createClient();const p=await db.from("profiles").select("organization_id,status,user_type").eq("id",s.authUserId).single();
 if(p.error||p.data?.status!=="active"||p.data.user_type!=="administrator"||!p.data.organization_id)return null;
 return {session:s,db,org:String(p.data.organization_id)};
}
export async function POST(request:Request){
 try{const a=await actor();if(!a)return NextResponse.json({error:"Administrador activo requerido."},{status:403,headers:noStore});
  const body=await request.json().catch(()=>null) as {key?:unknown;processId?:unknown;fileName?:unknown}|null;
  if(!body||typeof body.key!=="string"||!keyPattern.test(body.key)||typeof body.processId!=="string"||!canAccessProcess(a.session,body.processId)||typeof body.fileName!=="string"||!body.fileName.trim()||body.fileName.length>180)return NextResponse.json({error:"Expediente o archivo inválido."},{status:400,headers:noStore});
  const allowed=await a.db.rpc("iq_root2cause_evidence_access",{p_key:body.key,p_process:body.processId,p_write:true,p_uploader:a.session.authUserId});
  if(allowed.error||allowed.data!==true)return NextResponse.json({error:"Expediente sin permiso de carga."},{status:403,headers:noStore});
  const safe=body.fileName.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9._-]+/g,"-").replace(/-+/g,"-").slice(-140);
  if(!safe||safe==="."||safe==="..")return NextResponse.json({error:"Nombre de archivo inválido."},{status:400,headers:noStore});
  const path=`${a.session.authUserId}/attachments/corrective-actions/root2cause_evidence/${body.key}/${randomUUID()}/${safe}`;
  const ticket:Ticket={user:a.session.authUserId!,org:a.org,key:body.key,process:body.processId,path,issued:Date.now()};
  return NextResponse.json({path,ticket:encode(ticket)},{headers:noStore});
 }catch{return NextResponse.json({error:"No se pudo reservar la carga."},{status:503,headers:noStore});}
}
export async function DELETE(request:Request){
 try{const a=await actor();if(!a)return NextResponse.json({error:"Administrador activo requerido."},{status:403,headers:noStore});
  const body=await request.json().catch(()=>null) as {ticket?:unknown}|null;const t=decode(body?.ticket);
  if(!t||t.user!==a.session.authUserId||t.org!==a.org)return NextResponse.json({error:"Reserva inválida o vencida."},{status:403,headers:noStore});
  const admin=createAdminClient();const record=await admin.from("file_objects").select("id").eq("bucket_id",bucket).eq("object_path",t.path).limit(1);
  if(record.error){
   const incident=await admin.from("audit_log").insert({actor_id:t.user,organization_id:t.org,module:"corrective-actions",action:"root2cause.evidence_cleanup_failed",resource_type:"storage_object",resource_id:t.path,reason:"No se verificó si la carga tiene metadatos",metadata:{process_id:t.process,key:t.key}});
   if(incident.error)console.error("Root2Cause verification and audit failed",{user:t.user,key:t.key});
   return NextResponse.json({error:"No se verificó el registro del objeto; incidente pendiente de conciliación."},{status:503,headers:noStore});
  }
  if(record.data?.length)return NextResponse.json({error:"El archivo ya está vinculado y no puede retirarse."},{status:409,headers:noStore});
  let failure=false;
  try{const result=await admin.storage.from(bucket).remove([t.path]);failure=Boolean(result.error);}catch{failure=true;}
  if(failure){
   const incident=await admin.from("audit_log").insert({actor_id:t.user,organization_id:t.org,module:"corrective-actions",action:"root2cause.evidence_cleanup_failed",resource_type:"storage_object",resource_id:t.path,reason:"Carga sin metadatos; limpieza no confirmada",metadata:{process_id:t.process,key:t.key}});
   if(incident.error)console.error("Root2Cause cleanup and audit failed",{user:t.user,key:t.key});
   return NextResponse.json({error:"La limpieza no se confirmó; incidente pendiente de conciliación."},{status:503,headers:noStore});
  }
  return NextResponse.json({cleaned:true},{headers:noStore});
 }catch{return NextResponse.json({error:"No se pudo verificar la limpieza."},{status:503,headers:noStore});}
}
