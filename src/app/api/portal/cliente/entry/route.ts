import { linkHeaders, resolvePortalLink } from "@/lib/customer-portal-link-server";
export async function GET(request: Request) {
  const actor = await resolvePortalLink(request);
  return actor ? Response.json({companyId: actor.companyId, companyName: actor.companyName}, {headers: linkHeaders})
    : Response.json({error: "Enlace no disponible."}, {status: 403, headers: linkHeaders});
}
