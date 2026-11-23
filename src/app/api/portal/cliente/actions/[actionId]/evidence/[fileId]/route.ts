import { readPortalA3 } from "@/lib/customer-portal-a3-detail";
import { resolvePortalLink } from "@/lib/customer-portal-link-server";

export async function GET(request: Request, {params}: {params: Promise<{actionId:string;fileId:string}>}) {
  const {actionId,fileId} = await params;
  return readPortalA3(await resolvePortalLink(request), actionId, fileId);
}
