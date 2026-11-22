import { documentList } from "@/lib/customer-portal-documents-reader";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { resolveCustomerPortalActor } from "@/lib/customer-portal-server";

export async function GET() {
  return documentList(await resolveCustomerPortalActor(await getAuthenticatedSession()));
}
