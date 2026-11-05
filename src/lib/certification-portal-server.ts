import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CustomerPortalActor } from "@/lib/customer-portal-server";
import { certificationToday, certificationVisibleToCustomer, certificationCanPublish, type Certification, type CertificationFile } from "@/lib/customer-certifications";
import { certificationPages, CertificationError } from "@/lib/customer-certifications-server";
export async function publishedCertificationFiles(actor: CustomerPortalActor) {
  const db=createAdminClient();
  const today=certificationToday();
  const rows=await certificationPages<Certification>((f,t)=>db.from("certifications").select("id,name,workspace_id,external_organization_id,active,customer_visible,valid_from,valid_until")
    .eq("workspace_id",actor.workspaceId).eq("active",true).eq("customer_visible",true).order("id").range(f,t));
  const allowed=rows.filter(r=>actor.kind==="administrator"?r.workspace_id===actor.workspaceId&&r.customer_visible&&certificationCanPublish(r,today):!!actor.companyId&&certificationVisibleToCustomer(r,actor.workspaceId,actor.companyId,today));
  const files: Array<CertificationFile & {bucket_id:string;object_path:string;workspace_id:string;certification_name:string}> = [];
  for (let i=0;i<allowed.length;i+=100) {
    const chunk=allowed.slice(i,i+100);
    const found=await certificationPages<CertificationFile & {bucket_id:string;object_path:string;workspace_id:string}>((f,t)=>db.from("file_objects").select("id,resource_id,original_name,size_bytes,mime_type,version,is_current,created_at,uploaded_by,bucket_id,object_path,workspace_id")
      .eq("workspace_id",actor.workspaceId).eq("resource_type","customer_certification_document").eq("is_current",true).eq("bucket_id","integraq-private").is("deleted_at",null).in("resource_id",chunk.map(c=>c.id)).order("id").range(f,t));
    for (const file of found) {
      const certification=chunk.find(c=>c.id===file.resource_id);
      if (certification && file.workspace_id===actor.workspaceId && file.is_current && file.bucket_id==="integraq-private") files.push({...file,certification_name:certification.name});
    }
  }
  return files;
}
export async function publishedCertificationFile(actor:CustomerPortalActor,id:string) {
  const file=(await publishedCertificationFiles(actor)).find(f=>f.id===id);
  if (!file) throw new CertificationError("Documento no disponible.",404);
  return file;
}
