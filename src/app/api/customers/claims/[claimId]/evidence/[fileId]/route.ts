import { NextResponse } from "next/server";
import { claimActor, authorizedClaim, ClaimApiError, claimError, claimErrorStatus } from "@/lib/customer-claims-server";
import { uuidPattern } from "@/lib/customer-claims";
export async function GET(request: Request, context:{params:Promise<{claimId:string;fileId:string}>}) {
  try {
    const actor=await claimActor();
    const {claimId,fileId}=await context.params;
    await authorizedClaim(actor,claimId);
    if(!uuidPattern.test(fileId)) throw new ClaimApiError("Archivo inválido.");
    const file=await actor.admin.from("file_objects").select("id,bucket_id,object_path,original_name,mime_type")
      .eq("id",fileId).eq("resource_id",claimId).eq("workspace_id",actor.organizationId).eq("resource_type","customer_claim_evidence").eq("audience","internal").is("deleted_at",null).maybeSingle();
    if(file.error||!file.data||file.data.bucket_id!=="integraq-private") throw new ClaimApiError("Evidencia no disponible.",404);
    const preview=new URL(request.url).searchParams.get("preview")==="1";
    const safePreview=preview&&!/\.(eml|msg)$/i.test(file.data.original_name);
    const signed=await actor.admin.storage.from("integraq-private").createSignedUrl(file.data.object_path,60,safePreview?undefined:{download:file.data.original_name});
    if(signed.error||!signed.data) throw new ClaimApiError("No se pudo autorizar la descarga.",500);
    return NextResponse.json({url:signed.data.signedUrl},{headers:{"Cache-Control":"private, no-store"}});
  } catch(e){return NextResponse.json(claimError(e),{status:claimErrorStatus(e)});}
}
