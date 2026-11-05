import { createHash, randomUUID } from "node:crypto";
import { certificationActor, authorizedCertification, CertificationError, certificationFailure } from "@/lib/customer-certifications-server";
import { certificationFileMime, CERTIFICATION_FILE_LIMIT } from "@/lib/certification-files";
export const maxDuration = 30;
export async function POST(request: Request, context: {params: Promise<{certificationId: string}>}) {
  try {
    const actor = await certificationActor(true);
    const {certificationId} = await context.params;
    const record = await authorizedCertification(actor,certificationId);
    if (!record.active) throw new CertificationError("No se adjuntan archivos a expedientes retirados.",409);
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File) || !file.size || file.size>CERTIFICATION_FILE_LIMIT) throw new CertificationError("Selecciona un archivo de hasta 4 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mime: string;
    try { mime=certificationFileMime(file.name,bytes); } catch(e) { throw new CertificationError((e as Error).message); }
    const fileId = randomUUID();
    const filename = file.name.replace(/[^A-Za-z0-9._-]+/g,"-").slice(-150) || "documento";
    const objectPath = `customer-certifications/${actor.workspaceId}/${record.id}/${fileId}/${filename}`;
    const uploaded=await actor.admin.storage.from("integraq-private").upload(objectPath,bytes,{contentType:mime,upsert:false});
    if (uploaded.error) throw new CertificationError("No fue posible almacenar el archivo privado.",500);
    const result=await actor.admin.rpc("iq_certification_command",{actor_id:actor.id,workspace_id:actor.workspaceId,command:"file",payload:{id:record.id,revision:Number(data.get("revision")),fileId,filename:file.name,size:file.size,mime,objectPath,sha256:createHash("sha256").update(bytes).digest("hex"),replaceId:String(data.get("replaceId")??"")}});
    if (result.error) {
      console.error("Certification file registration failed",{certificationId,fileId,code:result.error.code});
      throw new CertificationError(`El archivo sigue privado pero no se registró en el expediente. Se conservó la versión anterior. Referencia: ${fileId}.`,409);
    }
    return Response.json(result.data,{headers:{"Cache-Control":"private, no-store"}});
  } catch(e) { return certificationFailure(e); }
}
