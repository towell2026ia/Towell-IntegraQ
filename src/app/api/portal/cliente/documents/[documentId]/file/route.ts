import { documentFile } from "@/lib/customer-portal-document-reader";
import { resolvePortalLink } from "@/lib/customer-portal-link-server";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return documentFile(await resolvePortalLink(request), request, context);
}
