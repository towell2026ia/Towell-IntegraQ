import type { ActiveSession } from "@/lib/session-data";

const prefix = "integraq.continuity.v1:";
const lifetime = 8 * 60 * 60 * 1000;
const dirtyForms = new Set<string>();
const events: { type: string; source: string; at: number }[] = [];
export function traceContinuity(type: string, source: string) {
  events.push({ type, source, at: Date.now() });
  if (events.length > 100) events.shift();
}
export function continuityDiagnostics() { return events.map(event => ({ ...event })); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function sessionAccessKey(session: ActiveSession) {
  return canonical({ user:session.authUserId??session.userId, organization:session.organizationId, mode:session.workspaceMode,
    type:session.userType, processes:session.assignedProcessIds, modules:session.assignedModuleIds,
    actions:session.moduleActionPermissions, specific:session.specificPermissions, documents:session.documentAccess, external:session.externalParty });
}
export function continuityIdentity(session: ActiveSession) {
  return session.authUserId && session.organizationId ? `${session.authUserId}:${session.organizationId}:${session.workspaceMode??"production"}` : null;
}
function safe(value: unknown, depth=0): boolean {
  if (depth>25) return false;
  if (value===null || typeof value==="string" || typeof value==="boolean" || typeof value==="number") return true;
  if (Array.isArray(value)) return value.every(v => safe(v,depth+1));
  if (value && typeof value==="object" && Object.getPrototypeOf(value)===Object.prototype) return Object.entries(value).every(([k,v]) => !/password|token|secret|cookie|authorization|binary/i.test(k) && safe(v,depth+1));
  return false;
}
export function readContinuity<T>(identity:string|null, access:string, key:string):T|null {
  if (!identity || typeof window==="undefined") return null;
  try {
    const name=prefix+identity+":"+key;
    const stored=JSON.parse(window.sessionStorage.getItem(name)??"null");
    if (!stored) return null;
    if (stored.version!==1 || stored.access!==access || typeof stored.expiresAt!=="number" || !Number.isFinite(stored.expiresAt) || stored.expiresAt<=Date.now() || !safe(stored.value)) { window.sessionStorage.removeItem(name); return null; }
    return stored.value as T;
  } catch { return null; }
}
export function writeContinuity(identity:string|null,access:string,key:string,value:unknown) {
  if (!identity || typeof window==="undefined" || !safe(value)) return false;
  try {
    const encoded=JSON.stringify({version:1,access,expiresAt:Date.now()+lifetime,value});
    if(encoded.length>200000)return false;
    window.sessionStorage.setItem(prefix+identity+":"+key,encoded);return true;
  } catch { return false; }
}
export function removeContinuity(identity:string|null,key:string) {
  try { if(identity && typeof window!=="undefined")window.sessionStorage.removeItem(prefix+identity+":"+key); } catch { /* Storage may be disabled. */ }
}
export function clearContinuity(reason="sign-out") {
  dirtyForms.clear();
  if(typeof window==="undefined")return;
  try { for(const key of Object.keys(window.sessionStorage))if(key.startsWith(prefix)||key==="integraq.continuity.identity")window.sessionStorage.removeItem(key); } catch { /* No stored context can be restored. */ }
  // Retire the old, unscoped A3 drafts on explicit sign-out. Never touch real module records.
  try { for(const key of Object.keys(window.localStorage))if(key==="integraq.a3Draft"||key.startsWith("integraq.a3Draft.claim."))window.localStorage.removeItem(key); } catch { /* No access to legacy storage. */ }
  traceContinuity("context-cleared",reason);
}
export function ensureContinuityIdentity(identity:string|null,access:string) {
  if(!identity||typeof window==="undefined")return;
  try{const next=JSON.stringify({identity,access});const previous=window.sessionStorage.getItem("integraq.continuity.identity");if(previous&&previous!==next)clearContinuity("access-change");window.sessionStorage.setItem("integraq.continuity.identity",next);}catch{/* Recovery remains unavailable when storage is disabled. */}
}
export function markDirty(key:string,dirty:boolean) { if(dirty)dirtyForms.add(key);else dirtyForms.delete(key); }
export function hasUnsavedChanges() { return dirtyForms.size>0; }
export function confirmLeaving() { return !hasUnsavedChanges() || window.confirm("Hay cambios sin guardar. Se conservará un borrador en esta pestaña. ¿Deseas salir de esta vista?"); }

// Focus and visibility often fire together. Coalesce both, with no polling or auth changes.
export function listenForBackgroundRefresh(source:string,refresh:()=>Promise<unknown>,minimumAge=60000) {
  let lastAttempt=Date.now(),pending=false,stopped=false;
  const run=()=>{
    if(stopped||pending||document.visibilityState==="hidden"||navigator.onLine===false||Date.now()-lastAttempt<minimumAge)return;
    pending=true;lastAttempt=Date.now();traceContinuity("background-refetch",source);
    void Promise.resolve().then(refresh).catch(()=>undefined).finally(()=>{pending=false;});
  };
  window.addEventListener("focus",run);document.addEventListener("visibilitychange",run);window.addEventListener("online",run);
  return ()=>{stopped=true;window.removeEventListener("focus",run);document.removeEventListener("visibilitychange",run);window.removeEventListener("online",run);};
}
