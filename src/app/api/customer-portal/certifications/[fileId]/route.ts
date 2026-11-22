import { certificationFile } from "@/lib/customer-portal-certificate-reader";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { resolveCustomerPortalActor } from "@/lib/customer-portal-server";

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  return certificationFile(await resolveCustomerPortalActor(await getAuthenticatedSession()), request, context);
}
