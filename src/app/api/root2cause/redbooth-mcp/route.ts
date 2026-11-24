import {NextResponse} from "next/server";
import {accessForDiscovery,beginConsent,connectionOrigin,connectionOwner,ConnectionError} from "@/lib/root2cause/redbooth-mcp-auth";
import {discoverRedboothTools} from "@/lib/root2cause/redbooth-mcp";
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};
export async function POST(request:Request) {
  try {
    const origin=connectionOrigin(request);
    if(request.headers.get("origin")!==origin) throw new ConnectionError("Origen no autorizado.",403);
    const owner=await connectionOwner();
    const op=new URL(request.url).searchParams.get("operation");
    if(op==="connect") return NextResponse.json({location:(await beginConsent(origin,owner)).href},{headers});
    if(op!=="discover") throw new ConnectionError("Operación no disponible.",400);
    const token=await accessForDiscovery(origin,owner);
    return NextResponse.json({tools:await discoverRedboothTools(token)},{headers});
  } catch(e) {
    return NextResponse.json({error:e instanceof ConnectionError?e.message:"No se pudo completar la consulta MCP."},{status:e instanceof ConnectionError?e.status:502,headers});
  }
}
