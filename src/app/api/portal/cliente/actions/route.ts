import { publishedActions } from "@/lib/customer-portal-actions-reader";
import { resolvePortalLink } from "@/lib/customer-portal-link-server";

export async function GET(request: Request) {
  return publishedActions(await resolvePortalLink(request));
}
