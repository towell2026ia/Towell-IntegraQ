import "server-only";
import {createCipheriv,createDecipheriv,randomBytes,createHash,timingSafeEqual} from "node:crypto";
import {cookies} from "next/headers";
import {RncpError,type RncpContext} from "./server";
const sessionName="__Host-iq-rncp-mail",stateName="__Host-iq-rncp-mail-state";
export function mailConfiguration(){
 const tenant=process.env.RNCP_GRAPH_TENANT_ID??"",client=process.env.RNCP_GRAPH_CLIENT_ID??"",secret=process.env.RNCP_GRAPH_CLIENT_SECRET??"",redirect=process.env.RNCP_GRAPH_REDIRECT_URI??"",key=process.env.RNCP_MAIL_COOKIE_KEY??"";
 if(process.env.RNCP_MAIL_ENABLED!=="true")return null;
 if(!/^[a-f0-9-]{36}$/i.test(tenant)||!/^[a-f0-9-]{36}$/i.test(client)||!secret||!/^[a-f0-9]{64}$/i.test(key))return null;
 try{const u=new URL(redirect);if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||u.pathname!=="/api/suppliers/rncp/mail/callback")return null;}catch{return null;}
 return {tenant,client,secret,redirect,key};
}
export function sealMailCookie(value:unknown,key:string){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",Buffer.from(key,"hex"),iv);return Buffer.concat([iv,cipher.update(JSON.stringify(value),"utf8"),cipher.final(),cipher.getAuthTag()]).toString("base64url");}
export function openMailCookie<T>(value:string,key:string):T{const bytes=Buffer.from(value,"base64url");if(bytes.length<29)throw new Error("invalid");const decipher=createDecipheriv("aes-256-gcm",Buffer.from(key,"hex"),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString("utf8")) as T;}
export async function loginMailbox(c:RncpContext){const user=await c.admin.auth.admin.getUserById(c.profile.id);const email=user.data.user?.email;
 if(user.error||!email||!user.data.user.email_confirmed_at)throw new RncpError("Confirma el correo de la cuenta IntegraQ antes de conectar su buzón.",409);return email;}
export interface MailSession{actorId:string;organizationId:string;email:string;accessToken:string;expires:number;}
export async function connectedMailbox(c:RncpContext){const config=mailConfiguration();if(!config)return null;
 try{const value=(await cookies()).get(sessionName)?.value;if(!value)return null;const s=openMailCookie<MailSession>(value,config.key);
  if(s.actorId!==c.profile.id||s.organizationId!==c.organizationId||s.expires<Date.now()+30_000||s.email.toLowerCase()!==(await loginMailbox(c)).toLowerCase())return null;return s;
 }catch{return null;}}
export async function graphIdentity(accessToken:string,expected:string){const response=await fetch("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName",{headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new RncpError("Microsoft 365 no confirmó la cuenta; vuelve a conectar el buzón.",403);
 const me=await response.json() as {mail?:string;userPrincipalName?:string};const email=me.mail||me.userPrincipalName;
 if(!email||email.toLowerCase()!==expected.toLowerCase())throw new RncpError("El buzón Microsoft 365 no coincide con el correo de la sesión IntegraQ.",403);return email;}
export async function beginMailboxConnection(c:RncpContext,reportId:string){const config=mailConfiguration();if(!config)throw new RncpError("Microsoft 365 pendiente de configuración y activación autorizada.",503);
 const email=await loginMailbox(c),state=randomBytes(24).toString("hex"),verifier=randomBytes(32).toString("base64url");
 const jar=await cookies();jar.set(stateName,sealMailCookie({actorId:c.profile.id,organizationId:c.organizationId,state,verifier,reportId,expires:Date.now()+600000},config.key),{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:600});
 const url=new URL(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/authorize`);
 url.search=new URLSearchParams({client_id:config.client,response_type:"code",redirect_uri:config.redirect,response_mode:"query",scope:"User.Read Mail.ReadWrite Mail.Send",state,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",login_hint:email,prompt:"select_account"}).toString();return url;
}
export async function completeMailboxConnection(c:RncpContext,url:URL){const config=mailConfiguration();if(!config)throw new RncpError("Correo deshabilitado.",503);const jar=await cookies(),raw=jar.get(stateName)?.value;jar.delete(stateName);
 if(!raw)throw new RncpError("La autorización expiró. Conecta nuevamente el buzón.",403);
 let state:{actorId:string;organizationId:string;state:string;verifier:string;reportId:string;expires:number};try{state=openMailCookie(raw,config.key);}catch{throw new RncpError("Autorización no válida.",403);}
 const received=url.searchParams.get("state")??"",code=url.searchParams.get("code");if(!code||!/^[a-f0-9]{48}$/.test(received)||state.expires<Date.now()||state.actorId!==c.profile.id||state.organizationId!==c.organizationId||received.length!==state.state.length||!timingSafeEqual(Buffer.from(received),Buffer.from(state.state)))throw new RncpError("Autorización de buzón no válida.",403);
 const response=await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.client,client_secret:config.secret,grant_type:"authorization_code",code,redirect_uri:config.redirect,code_verifier:state.verifier}),redirect:"error",signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new RncpError("Microsoft 365 no autorizó la conexión. Revisa el consentimiento con TI.",403);
 const token=await response.json() as {access_token?:string;expires_in?:number;scope?:string};const scope=(token.scope??"").toLowerCase().split(" ");
 if(!token.access_token||!scope.includes("mail.send")||!scope.includes("mail.readwrite")||!scope.includes("user.read"))throw new RncpError("Faltan permisos delegados de envío y documentos del buzón.",403);
 const email=await graphIdentity(token.access_token,await loginMailbox(c));const expires=Date.now()+Math.min(token.expires_in??0,3600)*1000;
 const sealed=sealMailCookie({actorId:c.profile.id,organizationId:c.organizationId,email,accessToken:token.access_token,expires},config.key);
 if(sealed.length>3800)throw new RncpError("La credencial excede la sesión segura disponible; requiere revisión de configuración.",503);
 jar.set(sessionName,sealed,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:Math.max(0,Math.floor((expires-Date.now())/1000))});
 const target=new URL(config.redirect);target.pathname="/";target.search=new URLSearchParams({rncp:state.reportId}).toString();target.hash="suppliers";return target;
}
