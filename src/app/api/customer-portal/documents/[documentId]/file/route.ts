import { documentFile } from "@/lib/customer-portal-document-reader";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { resolveCustomerPortalActor } from "@/lib/customer-portal-server";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return documentFile(await resolveCustomerPortalActor(await getAuthenticatedSession()), request, context);
}
