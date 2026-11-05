import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { claimActor, authorizedClaim, ClaimApiError, claimError, claimErrorStatus } from "@/lib/customer-claims-server";
import { CLAIM_FILE_LIMIT, claimFileMime } from "@/lib/customer-claim-files";
export const maxDuration = 30;
export async function POST(request: Request, context: { params: Promise<{ claimId: string }> }) {
  try {
    let actor;
    let registrationOnly=false;
    try { actor=await claimActor("update"); } catch(e) {
      if(!(e instanceof ClaimApiError)||e.status!==403)throw e;
      actor=await claimActor("create");registrationOnly=true;
    }
    const { claimId } = await context.params;
    const claim = await authorizedClaim(actor, claimId);
    if(registrationOnly&&claim.created_by!==actor.id)throw new ClaimApiError("No puedes adjuntar evidencia a este reclamo.",403);
    if (claim.cancelled_at) throw new ClaimApiError("No se adjuntan archivos a reclamos anulados.",409);
    const data = await request.formData();
    if(registrationOnly&&data.get("replaceId"))throw new ClaimApiError("La sustitución requiere permiso de edición.",403);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size || file.size>CLAIM_FILE_LIMIT) throw new ClaimApiError("Selecciona un archivo de hasta 4 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mime: string;
    try { mime = claimFileMime(file.name,bytes); } catch(e) { throw new ClaimApiError((e as Error).message); }
    const fileId = randomUUID();
    const name = file.name.replace(/[^A-Za-z0-9._-]+/g,"-").slice(-150) || "evidencia";
    const objectPath = `claim-evidence/${actor.organizationId}/${claimId}/${fileId}/${name}`;
    const uploaded = await actor.admin.storage.from("integraq-private").upload(objectPath,bytes,{ contentType:mime, upsert:false });
    if (uploaded.error) throw new ClaimApiError("No fue posible almacenar el archivo.",500);
    const saved=await actor.admin.rpc("iq_customer_claim_command",{ actor_id:actor.id,workspace_id:actor.organizationId,command:"evidence",payload:{ id:claimId,fileId,filename:file.name,size:file.size,mime,objectPath,sha256:createHash("sha256").update(bytes).digest("hex"),replaceId:String(data.get("replaceId") ?? "") } });
    if(saved.error) {
      console.error("Claim evidence metadata registration failed",{claimId,fileId,objectPath,code:saved.error.code});
      throw new ClaimApiError(`El archivo quedó privado, pero no pudo registrarse en el expediente. No se sustituyó evidencia anterior. Referencia para el administrador: ${fileId}.`,409);
    }
    return NextResponse.json(saved.data);
  } catch(e) { return NextResponse.json(claimError(e),{status:claimErrorStatus(e)}); }
}
