import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCustomerPortalActor } from "@/lib/customer-portal-server";
import { publishedCertificationFile } from "@/lib/certification-portal-server";
import { certificationFailure, CertificationError } from "@/lib/customer-certifications-server";
import { certificationUuid } from "@/lib/customer-certifications";
export async function GET(request:Request,context:{params:Promise<{fileId:string}>}) {
  try {
    const actor=await resolveCustomerPortalActor(await getAuthenticatedSession());
    if (!actor) throw new CertificationError("Acceso al Portal de Clientes no autorizado.",403);
    const {fileId}=await context.params;
    if (!certificationUuid.test(fileId)) throw new CertificationError("Documento no disponible.",404);
    const file=await publishedCertificationFile(actor,fileId);
    const download=new URL(request.url).searchParams.get("disposition")==="download";
    const result=await createAdminClient().storage.from("integraq-private").createSignedUrl(file.object_path,60,download?{download:file.original_name}:undefined);
    if (result.error || !result.data) throw new CertificationError("No fue posible abrir el documento.",500);
    return new Response(null,{status:302,headers:{Location:result.data.signedUrl,"Cache-Control":"private, no-store"}});
  } catch(e) { return certificationFailure(e); }
}
