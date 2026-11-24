import "server-only";
import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";
import {cookies} from "next/headers";
import {getAuthenticatedSession} from "@/lib/supabase/auth-session";
import {canPerformModuleAction} from "@/lib/module-permissions";

export const mcpResource = "https://redbooth.com/api/mcp";
const issuer = "https://redbooth.com";
const origins = ["https://towell-integraq.netlify.app","http://127.0.0.1:3000"];
export const callbackPath = "/api/root2cause/redbooth-mcp/callback";
const scopes = "me projects users tasks";
const flowLifetime = 600;
const sessionLifetime = 8 * 3600;

export class ConnectionError extends Error {
  constructor(message:string, readonly status:number) {super(message);}
}
export function connectionOrigin(request:Request) {
  const origin = new URL(request.url).origin;
  if (!origins.includes(origin)) throw new ConnectionError("Origen de IntegraQ no autorizado.",403);
  return origin;
}
export async function connectionOwner() {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId || !session.organizationId || session.workspaceMode !== "production" ||
    session.userType !== "Administrador" || !canPerformModuleAction(session,"corrective-actions","update")) {
    throw new ConnectionError("Se requiere administración de Root2Cause.",403);
  }
  return [session.organizationId,session.authUserId].join(":");
}
function configuration() {
  const clientId = process.env.ROOT2CAUSE_REDBOOTH_MCP_CLIENT_ID;
  const key = process.env.ROOT2CAUSE_REDBOOTH_MCP_SESSION_KEY ?? "";
  if (!clientId || !/^[a-f0-9]{64}$/i.test(key)) throw new ConnectionError("El cliente OAuth de IntegraQ está pendiente de configurar.",503);
  return {clientId,key:Buffer.from(key,"hex")};
}
type Purpose = "flow"|"session";
type Binding = {owner:string;origin:string;until:number};
type Flow = Binding & {state:string;verifier:string};
type Grant = Binding & {access:string;refresh?:string;expires:number};
function cookieSpec(purpose:Purpose,origin:string) {
  const secure = origin.startsWith("https://");
  return {name:(secure?"__Host-":"")+"integraq-redbooth-"+purpose, secure, httpOnly:true, sameSite:"lax" as const,path:"/"};
}
async function save(purpose:Purpose,value:Flow|Grant) {
  const {key,clientId}=configuration();
  const iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key,iv);
  cipher.setAAD(Buffer.from([purpose,value.origin,clientId].join("|")));
  const body=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  const sealed=Buffer.concat([iv,cipher.getAuthTag(),body]).toString("base64url");
  if(sealed.length>3750) throw new ConnectionError("La sesión OAuth excede el tamaño admitido.",502);
  (await cookies()).set({...cookieSpec(purpose,value.origin),value:sealed,maxAge:Math.max(0,Math.ceil((value.until-Date.now())/1000))});
}
async function read<T extends Binding>(purpose:Purpose,origin:string,owner:string):Promise<T> {
  const {key,clientId}=configuration();
  const raw=(await cookies()).get(cookieSpec(purpose,origin).name)?.value;
  if(raw) try {
    const bytes=Buffer.from(raw,"base64url");
    const decipher=createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12));
    decipher.setAAD(Buffer.from([purpose,origin,clientId].join("|")));
    decipher.setAuthTag(bytes.subarray(12,28));
    const value:T=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());
    if(value.owner===owner && value.origin===origin && value.until>Date.now()) return value;
  } catch { /* Expiry and invalid credentials both require a new authorization. */ }
  throw new ConnectionError("Conecta tu sesión de IntegraQ con Redbooth.",401);
}
export async function beginConsent(origin:string,owner:string) {
  const {clientId}=configuration();
  const verifier=randomBytes(48).toString("base64url"), state=randomBytes(32).toString("base64url");
  const url=new URL("/oauth2/authorize",issuer);
  url.search=new URLSearchParams({client_id:clientId,response_type:"code",redirect_uri:origin+callbackPath,
    resource:mcpResource,scope:scopes,state,code_challenge_method:"S256",
    code_challenge:createHash("sha256").update(verifier).digest("base64url")}).toString();
  await save("flow",{origin,owner,until:Date.now()+flowLifetime*1000,state,verifier});
  return url;
}
async function exchange(params:Record<string,string>) {
  const {clientId}=configuration();
  const response=await fetch(issuer+"/oauth2/token",{method:"POST",cache:"no-store",redirect:"error",
    signal:AbortSignal.timeout(12000),headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},
    body:new URLSearchParams({...params,client_id:clientId,resource:mcpResource})});
  if (!response.ok) throw new ConnectionError(response.status>=500 ? "Redbooth no está disponible." : "Redbooth rechazó la autorización. Vuelve a conectar la cuenta.",response.status>=500?503:401);
  const result=await response.json();
  if(typeof result.access_token!=="string" || !result.access_token || String(result.token_type).toLowerCase()!=="bearer" ||
    !Number.isFinite(result.expires_in) || result.expires_in<=0 ||
    (result.refresh_token!==undefined && (typeof result.refresh_token!=="string" || !result.refresh_token))) {
    throw new ConnectionError("Respuesta OAuth incompleta de Redbooth.",502);
  }
  return {access:result.access_token as string,refresh:result.refresh_token as string|undefined,expires:Date.now()+result.expires_in*1000};
}
export async function finishConsent(url:URL,owner:string) {
  const flow=await read<Flow>("flow",url.origin,owner);
  const code=url.searchParams.get("code");
  if(url.searchParams.get("state")!==flow.state) throw new ConnectionError("La solicitud OAuth no corresponde a esta sesión.",403);
  (await cookies()).set({...cookieSpec("flow",url.origin),value:"",maxAge:0});
  if(!code || url.searchParams.has("error")) throw new ConnectionError("Redbooth no concedió el acceso.",403);
  const tokens=await exchange({grant_type:"authorization_code",code,code_verifier:flow.verifier,redirect_uri:url.origin+callbackPath});
  await save("session",{origin:url.origin,owner,until:Date.now()+sessionLifetime*1000,...tokens});
}
export async function accessForDiscovery(origin:string,owner:string) {
  const current=await read<Grant>("session",origin,owner);
  if(current.expires>Date.now()+30_000) return current.access;
  if(!current.refresh) throw new ConnectionError("La sesión venció. Conecta nuevamente Redbooth.",401);
  const tokens=await exchange({grant_type:"refresh_token",refresh_token:current.refresh});
  await save("session",{...current,...tokens,refresh:tokens.refresh??current.refresh});
  return tokens.access;
}
