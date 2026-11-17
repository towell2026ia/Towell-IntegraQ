import {rncpContext,RncpError} from "@/lib/rncp/server";
import {photoFailure} from "@/lib/rncp/initial-photo-server";
import {persistGeneratedPdf} from "@/lib/rncp/generated-pdf-server";
export const runtime="nodejs";
export const maxDuration=60;
export async function POST(_request:Request,{params}:{params:Promise<{reportId:string}>}){
 try{const {reportId}=await params;if(!/^[a-f0-9-]{36}$/i.test(reportId))throw new RncpError("RNCP no válido.");
  const context=await rncpContext("update");const result=await persistGeneratedPdf(context,reportId);
  return Response.json({...result,notified:false},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return photoFailure(error);}
}
