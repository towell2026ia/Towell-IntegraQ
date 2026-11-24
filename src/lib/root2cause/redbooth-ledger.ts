import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROOT2CAUSE_REDBOOTH_TARGET, confirmedTaskUrl, type SyncRecord } from "./redbooth-target";
import type { RedboothTask, SyncLedger } from "./redbooth";

// No transport or remote write is enabled by constructing this adapter.
export function redboothLedger(): SyncLedger {
  const db = createAdminClient();
  const table = "root2cause_redbooth_reservations";
  async function transition(key:string, from:string[], values:Record<string,unknown>) {
    const {data,error} = await db.from(table).update({...values,updated_at:new Date().toISOString()})
      .eq("correlation",key).in("state",from).select("correlation").maybeSingle();
    if (error || !data) throw new Error("No se confirmó el estado de la reserva. Requiere conciliación.");
  }
  return {
    async claim(key,fingerprint) {
      const reservation = await db.from(table).insert({correlation:key,fingerprint});
      if (!reservation.error) return {state:"new"};
      if (reservation.error.code !== "23505") throw new Error("No se pudo reservar la operación.");
      const {data,error} = await db.from(table).select("fingerprint,state,task,attachment").eq("correlation",key).single();
      if (error || !data || data.fingerprint !== fingerprint) throw new Error("Reserva no verificable o versión diferente.");
      return data.state === "done" ? {state:"done",task:data.task as RedboothTask,attachment:data.attachment ?? undefined} : {state:"uncertain"};
    },
    created:(key,task) => transition(key,["reserved"],{state:"created",task}),
    complete:(key,{task,attachment}) => transition(key,["created"],{state:"done",task,attachment:attachment ?? null}),
    uncertain:key => transition(key,["reserved","created"],{state:"uncertain"}),
  };
}

/** Enrich only confirmed identifiers already returned by the caller's access-controlled RPC. */
export async function readConfirmedTaskLinks(org:string,action:string,records:SyncRecord[]):Promise<SyncRecord[]> {
  const prefix = org+":"+action+":";
  const suffix = ":"+ROOT2CAUSE_REDBOOTH_TARGET.projectId+":"+ROOT2CAUSE_REDBOOTH_TARGET.listId;
  const confirmed = records.filter(r=>r.sync_state==="synced" && r.remote_id && /^[1-9]\d*$/.test(r.remote_id));
  if (!confirmed.length) return records;
  const db = createAdminClient();
  const links = new Map<string,string>();
  for (let i=0;i<confirmed.length;i+=50) {
    const subset = confirmed.slice(i,i+50);
    const keys = subset.map(r=>prefix+r.item+suffix);
    const {data,error} = await db.from("root2cause_redbooth_reservations").select("correlation,task").in("correlation",keys).eq("state","done");
    if (error) throw new Error("No se pudieron verificar los vínculos confirmados.");
    for (const row of data ?? []) {
      const task = row.task as RedboothTask|null;
      const expected = subset.find(r=>prefix+r.item+suffix===row.correlation);
      if (!expected || !task || String(task.id)!==expected.remote_id || task.projectId!==ROOT2CAUSE_REDBOOTH_TARGET.projectId || task.listId!==ROOT2CAUSE_REDBOOTH_TARGET.listId) continue;
      const url=confirmedTaskUrl(String(task.id),task.url);
      if(url) links.set(expected.item,url);
    }
  }
  return records.map(r=>({...r,url:links.get(r.item)}));
}
