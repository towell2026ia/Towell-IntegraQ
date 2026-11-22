import { documentList } from "@/lib/customer-portal-documents-reader";
import { resolvePortalLink } from "@/lib/customer-portal-link-server";

export async function GET(request: Request) {
  return documentList(await resolvePortalLink(request));
}
