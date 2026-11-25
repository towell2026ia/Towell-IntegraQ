// RCA-10 remains disabled until its production activation is approved.
export const ROOT2CAUSE_REDBOOTH_ENABLED = false;

/** Destination expressly confirmed by Calidad. Never supplied by browser input. */
export const ROOT2CAUSE_REDBOOTH_TARGET = Object.freeze({
  name: "QTW",
  projectId: 2233821,
  listId: 6673813,
  url: "https://redbooth.com/a/#!/projects/2233821/task-lists/6673813",
});
export function assertRootCauseRedboothTarget(projectId:number,listId:number):void {
  if(projectId!==ROOT2CAUSE_REDBOOTH_TARGET.projectId||listId!==ROOT2CAUSE_REDBOOTH_TARGET.listId){
    throw new Error("Root2Cause sólo permite el proyecto QTW (2233821) y la lista 6673813.");
  }
}

export type SyncRecord = {item:string; sync_state:string; remote_id:string|null; url?:string};
export type PlanSync = {label:string; url?:string};
export function confirmedTaskUrl(remoteId:string, candidate?:string):string|undefined {
  if (!candidate || !/^[1-9]\d*$/.test(remoteId)) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:" && ["redbooth.com","www.redbooth.com"].includes(url.hostname) &&
      !url.username && !url.password && !url.port && !url.search && url.pathname === "/a/" &&
      url.hash === "#!/projects/"+ROOT2CAUSE_REDBOOTH_TARGET.projectId+"/tasks/"+remoteId) return url.href;
  } catch { /* A malformed stored link needs reconciliation. */ }
  return undefined;
}
export function getPlanSync(records:SyncRecord[]|null, item:string, storedUrl?:string):PlanSync {
  if (records === null) return {label:"Sin verificar"};
  const record = records.find(row=>row.item === item);
  if (!record) return {label:storedUrl ? "Requiere conciliación" : "Pendiente de sincronizar"};
  if (record.sync_state === "error") return {label:"Requiere conciliación"};
  if (record.sync_state === "pending") return {label:"Sincronización en curso"};
  if (record.sync_state !== "synced" || !record.remote_id || !/^[1-9]\d*$/.test(record.remote_id)) return {label:"Error de vinculación"};
  const url = confirmedTaskUrl(record.remote_id,record.url ?? storedUrl);
  if (!url) return {label:"Requiere conciliación"};
  return {label:"Sincronizada · tarea "+record.remote_id,url};
}
export async function readSyncRecords(actionId:string,signal?:AbortSignal):Promise<SyncRecord[]> {
  const response = await fetch("/api/root2cause/plan-followup?action="+encodeURIComponent(actionId),{cache:"no-store",signal});
  if (!response.ok) throw new Error("No se pudo verificar la sincronización.");
  const data = await response.json();
  if (!Array.isArray(data.records) || !data.records.every((r:SyncRecord)=>r && typeof r.item === "string" && typeof r.sync_state === "string" && (r.remote_id === null || typeof r.remote_id === "string"))) throw new Error("Registro de sincronización incompleto.");
  return data.records;
}
