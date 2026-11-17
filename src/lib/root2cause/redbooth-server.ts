import "server-only";
import {ROOT2CAUSE_REDBOOTH_TARGET} from "./redbooth-target";
/** Confirmed internal proxy routes only. Credentials never reach the browser. */
export function internalRedboothConfiguration(){
 if(process.env.ROOT2CAUSE_REDBOOTH_ENABLED!=='true')return null;
 const value=process.env.REDBOOTH_INTERNAL_BASE_URL,token=process.env.REDBOOTH_INTERNAL_TOKEN;
 if(!value||!token)return null;const url=new URL(value);
 // The supplied LAN HTTP URL is not suitable for cloud activation with a bearer secret.
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('El conector requiere una URL HTTPS autorizada y accesible desde el servidor.');
 return {base:url.href.replace(/\/$/,''),token};
}
export async function readInternalRedbooth(route:'me'|'activities'|'tasks'|'comments'|'files'|'images',parameters:Record<string,string>={}){
 const routes=['me','activities','tasks','comments','files','images'];
 if(!routes.includes(route))throw new Error('Ruta de lectura no documentada.');
 const keys=route==='me'?[]:route==='tasks'||route==='activities'?['project_id','per_page']:route==='comments'?['target_type','target_id']:['project_id','target_type','target_id'];
 for(const [key,value] of Object.entries(parameters)){
  if(!keys.includes(key)||(key==='target_type'?value!=='Task':!/^\d+$/.test(value)||Number(value)<1||!Number.isSafeInteger(Number(value))||(key==='per_page'&&Number(value)>100)))throw new Error('Parámetros de lectura no documentados o inválidos.');
 }
 const projectId=String(ROOT2CAUSE_REDBOOTH_TARGET.projectId);
 if(parameters.project_id!==undefined&&parameters.project_id!==projectId)throw new Error('Consulta fuera del proyecto QTW autorizado.');
 const query=['tasks','activities','files','images'].includes(route)?{...parameters,project_id:projectId}:parameters;
 const c=internalRedboothConfiguration();if(!c)throw new Error('Redbooth desactivado o pendiente de configuración.');
 const url=new URL(`${c.base}/${route}`);for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
 const response=await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${c.token}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`El conector interno respondió ${response.status}.`);return response.json() as Promise<unknown>;
}
