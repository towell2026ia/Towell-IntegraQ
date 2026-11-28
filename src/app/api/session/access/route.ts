import { getVerifiedSessionContext } from "@/lib/supabase/auth-session";
import { sessionAccessKey } from "@/lib/workspace-continuity";

export async function GET() {
  const context = await getVerifiedSessionContext().catch(() => undefined);
  const headers = {"Cache-Control":"private, no-store","Vary":"Cookie"};
  if (context === undefined || context?.failure === "unavailable") return new Response(null,{status:503,headers});
  if (!context?.session) return new Response(null,{status:401,headers});
  return Response.json({access:sessionAccessKey(context.session)},{headers});
}
