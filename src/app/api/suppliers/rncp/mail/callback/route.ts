import {rncpContext} from "@/lib/rncp/server";
import {completeMailboxConnection} from "@/lib/rncp/mail-auth";
import {photoFailure} from "@/lib/rncp/initial-photo-server";
export async function GET(request:Request){try{const c=await rncpContext("update");return Response.redirect(await completeMailboxConnection(c,new URL(request.url)),303);}catch(e){return photoFailure(e);}}
