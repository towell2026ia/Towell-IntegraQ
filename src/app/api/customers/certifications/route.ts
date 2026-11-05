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
    return Response.json({certifications,customers,responsibleUsers,files,history,administrator:actor.administrator,today:certificationToday()} satisfies CertificationCatalog,{headers:{"Cache-Control":"private, no-store"}});
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
    if (input.command !== "save" || input.revision != null) await authorizedCertification(actor, String(input.id));
    if (input.command === "retire" && !String(input.reason ?? "").trim()) throw new CertificationError("Indica el motivo de retiro.");
    const saved = await actor.admin.rpc("iq_certification_command",{actor_id:actor.id,workspace_id:actor.workspaceId,command:input.command,payload:input});
    if (saved.error) throw new CertificationError(saved.error.message.includes("CONCURRENT") ? "El expediente cambió. Recarga antes de guardar." : "No se confirmó el cambio. Verifica responsable, cliente, fechas y archivos vigentes.",saved.error.code==="42501"?403:409);
    return Response.json(saved.data,{headers:{"Cache-Control":"private, no-store"}});
  } catch(e) { return certificationFailure(e); }
}
