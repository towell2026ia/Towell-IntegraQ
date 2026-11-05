import { certificationActor, authorizedCertification, CertificationError, certificationFailure } from "@/lib/customer-certifications-server";
import { certificationUuid } from "@/lib/customer-certifications";
export async function GET(request: Request, context: {params: Promise<{certificationId:string;fileId:string}>}) {
  try {
    const actor=await certificationActor();
    const {certificationId,fileId}=await context.params;
    await authorizedCertification(actor,certificationId);
    if (!certificationUuid.test(fileId)) throw new CertificationError("Archivo inválido.");
    const file=await actor.admin.from("file_objects").select("bucket_id,object_path,original_name")
      .eq("id",fileId).eq("resource_id",certificationId).eq("resource_type","customer_certification_document")
      .eq("workspace_id",actor.workspaceId).eq("audience","internal").is("deleted_at",null).maybeSingle();
    if (file.error || !file.data || file.data.bucket_id!=="integraq-private") throw new CertificationError("Archivo no disponible.",404);
    const preview=new URL(request.url).searchParams.get("preview")==="1";
    const signed=await actor.admin.storage.from("integraq-private").createSignedUrl(file.data.object_path,60,preview?undefined:{download:file.data.original_name});
    if (signed.error || !signed.data) throw new CertificationError("No se pudo autorizar el archivo.",500);
    return Response.json({url:signed.data.signedUrl},{headers:{"Cache-Control":"private, no-store"}});
  } catch(e) { return certificationFailure(e); }
}
