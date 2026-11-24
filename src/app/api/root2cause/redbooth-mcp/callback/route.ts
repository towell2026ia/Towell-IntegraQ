import {NextResponse} from "next/server";
import {connectionOrigin,connectionOwner,ConnectionError,finishConsent} from "@/lib/root2cause/redbooth-mcp-auth";
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};
export async function GET(request:Request) {
  try {
    const origin=connectionOrigin(request);
    await finishConsent(new URL(request.url),await connectionOwner());
    return NextResponse.redirect(new URL("/#corrective-actions",origin),{status:303,headers});
  } catch(e) {
    return NextResponse.json({error:e instanceof ConnectionError?e.message:"No se pudo confirmar OAuth con Redbooth."},{status:e instanceof ConnectionError?e.status:502,headers});
  }
}
