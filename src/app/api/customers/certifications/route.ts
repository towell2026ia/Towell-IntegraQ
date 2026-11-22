import { individualPublicationReady, unavailableMessage } from "@/lib/customer-portal-contract-server";
import { certificationActor, authorizedCertification, certificationPages, CertificationError, certificationFailure } from "@/lib/customer-certifications-server";
import { certificationToday, validateCertification, type CertificationCatalog } from "@/lib/customer-certifications";

export async function GET() {
  try {
    const actor = await certificationActor();
    const [certifications, customers, responsibleUsers] = await Promise.all([
      certificationPages<CertificationCatalog["certifications"][number]>((f,t) => actor.admin.from("certifications").select("*").eq("workspace_id", actor.workspaceId).order("id").range(f,t)),
      certificationPages<CertificationCatalog["customers"][number]>((f,t) => actor.admin.from("organizations").select("id,code,name,active").eq("kind", "customer").eq("owning_organization_id", actor.workspaceId).order("id").range(f,t)),
      certificationPages<CertificationCatalog["responsibleUsers"][number]>((f,t) => actor.admin.from("profiles").select("id,full_name").eq("organization_id", actor.workspaceId).in("user_type", ["administrator", "internal"]).eq("status", "active").eq("workspace_mode", "production").order("id").range(f,t)),
    ]);
    const files: CertificationCatalog["files"] = [], history: CertificationCatalog["history"] = [];
    for (let start=0; start<certifications.length; start+=100) {
      const ids = certifications.slice(start,start+100).map(c => c.id);
      files.push(...await certificationPages<CertificationCatalog["files"][number]>((f,t) => actor.admin.from("file_objects").select("id,resource_id,original_name,size_bytes,mime_type,version,is_current,created_at,uploaded_by").eq("workspace_id",actor.workspaceId).eq("resource_type","customer_certification_document").in("resource_id",ids).is("deleted_at",null).order("id").range(f,t)));
      history.push(...await certificationPages<CertificationCatalog["history"][number]>((f,t) => actor.admin.from("audit_log").select("id,resource_id,action,actor_id,created_at,reason").eq("organization_id",actor.workspaceId).eq("resource_type","customer_certification").in("resource_id",ids).order("created_at",{ascending:false}).order("id").range(f,t)));
    }
    const assignmentAvailable = actor.administrator && await individualPublicationReady().catch(() => false);
    return Response.json({assignmentAvailable,certifications,customers,responsibleUsers,files,history,administrator:actor.administrator,today:certificationToday()} satisfies CertificationCatalog,{headers:{"Cache-Control":"private, no-store"}});
  } catch(e) { return certificationFailure(e); }
}
export async function POST(request: Request) {
  try {
    const actor = await certificationActor(true);
    const input = await request.json();
    if (!["save","publish","unpublish","retire"].includes(input.command)) throw new CertificationError("Operación inválida.");
    if (input.command === "save") {
      try { validateCertification(input); } catch(e) { throw new CertificationError((e as Error).message); }
    }
    let currentCertification;
    if (input.command !== "save" || input.revision != null) currentCertification = await authorizedCertification(actor, String(input.id));
    if (input.command === "publish") {
      const recipient = currentCertification?.external_organization_id;
      if (!recipient) throw new CertificationError("Selecciona un cliente destinatario antes de publicar");
      const company = await actor.admin.from("organizations").select("id").eq("id",recipient)
        .eq("owning_organization_id",actor.workspaceId).eq("kind","customer").eq("active",true).maybeSingle();
      if (company.error) throw new CertificationError("No fue posible verificar el destinatario.",503);
      if (!company.data) throw new CertificationError("El destinatario no es un cliente activo de esta organización.",403);
    }
    if (input.command === "retire" && !String(input.reason ?? "").trim()) throw new CertificationError("Indica el motivo de retiro.");
    const assigning = input.command === "save" && currentCertification && !currentCertification.external_organization_id && !!input.customerId;
    if (assigning && !await individualPublicationReady()) throw new CertificationError(unavailableMessage,503);
    const saved = assigning
      ? await actor.admin.rpc("iq_u01_save_certification_recipient",{p_actor_id:actor.id,p_workspace_id:actor.workspaceId,p_payload:input})
      : await actor.admin.rpc("iq_certification_command",{actor_id:actor.id,workspace_id:actor.workspaceId,command:input.command,payload:input});
    if (saved.error) {
      const { message, code } = saved.error;
      if (message.includes("CONCURRENT_EDIT")) throw new CertificationError("El expediente cambió. Recarga antes de guardar.",409);
      if (message.includes("RECIPIENT_REQUIRED")) throw new CertificationError("Selecciona un cliente destinatario antes de publicar");
      if (code === "42501") throw new CertificationError("Sin autorización para el expediente o su destinatario.",403);
      if (message.includes("NOT_FOUND")) throw new CertificationError("Certificación no disponible.",404);
      if (message.includes("CURRENT_FILE_REQUIRED")) throw new CertificationError("Adjunta un archivo vigente antes de publicar.");
      if (message.includes("CUSTOMER_IMMUTABLE")) throw new CertificationError("Sólo se puede asignar un destinatario a un borrador privado sin cliente.");
      if (code === "P0001" || code === "22P02") throw new CertificationError("Verifica los datos, la vigencia y el estado del expediente.");
      throw new CertificationError("No se pudo confirmar la operación de Certificaciones.",500);
    }
    return Response.json(saved.data,{headers:{"Cache-Control":"private, no-store"}});
  } catch(e) { return certificationFailure(e); }
}
