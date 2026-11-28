import {rncpContext,RncpError} from "@/lib/rncp/server";
import {mailConfiguration,beginMailboxConnection} from "@/lib/rncp/mail-auth";
import {photoFailure} from "@/lib/rncp/initial-photo-server";
export async function GET(request:Request){try{if(!mailConfiguration())return new Response(null,{status:404});const reportId=new URL(request.url).searchParams.get("reportId")??"";if(!/^[a-f0-9-]{36}$/i.test(reportId))throw new RncpError("RNCP no válido.");const c=await rncpContext("update");if(c.session?.specificPermissions?.["rncp.enviar_rncp"]!==true)throw new RncpError("Envío de RNCP no autorizado.",403);return Response.redirect(await beginMailboxConnection(c,reportId),303);}catch(e){return photoFailure(e);}}
