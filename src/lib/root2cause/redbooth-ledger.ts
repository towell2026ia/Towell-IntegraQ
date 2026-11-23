import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
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
