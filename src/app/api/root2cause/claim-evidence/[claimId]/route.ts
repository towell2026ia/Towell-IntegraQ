import { NextResponse } from "next/server";
import { claimActor, authorizedClaim, ClaimApiError, claimError, claimErrorStatus } from "@/lib/customer-claims-server";
export async function GET(_request: Request, context: { params: Promise<{ claimId: string }> }) {
  try {
    const actor = await claimActor("view");
    const { claimId } = await context.params;
    await authorizedClaim(actor, claimId);
    const result = await actor.admin.from("file_objects").select("id,original_name,created_at")
      .eq("resource_id",claimId).eq("resource_type","customer_claim_evidence").eq("workspace_id",actor.organizationId)
      .eq("bucket_id","integraq-private").eq("audience","internal").eq("is_current",true).is("deleted_at",null).order("created_at");
    if (result.error) throw new ClaimApiError("No se pudieron leer las referencias del reclamo.",503);
    return NextResponse.json({files:result.data ?? []},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) { return NextResponse.json(claimError(error),{status:claimErrorStatus(error)}); }
}
