import "server-only";
import { RncpError, type RncpContext } from "./server";
export async function requireRncpFlow(context: Pick<RncpContext,"supabase">) {
 const r=await context.supabase.rpc("iq_rncp_flow_contract");
 if(r.error?.code==="42501")throw new RncpError("No tienes permiso para operar el flujo RNCP.",403);
 if(r.error || r.data!==1) throw new RncpError("Activación pendiente: falta el contrato revisado de folios y clasificación RNCP. No se guardaron cambios.",503);
}
