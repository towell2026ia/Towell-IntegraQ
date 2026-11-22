import { certificationFile } from "@/lib/customer-portal-certificate-reader";
import { resolvePortalLink } from "@/lib/customer-portal-link-server";

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  return certificationFile(await resolvePortalLink(request), request, context);
}
