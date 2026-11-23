import { readPortalA3 } from "@/lib/customer-portal-a3-detail";
import { resolveCustomerPortalActor } from "@/lib/customer-portal-server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";

export async function GET(request: Request, {params}: {params: Promise<{actionId:string;fileId:string}>}) {
  const {actionId,fileId} = await params;
  return readPortalA3(await resolveCustomerPortalActor(await getAuthenticatedSession()), actionId, fileId);
}
