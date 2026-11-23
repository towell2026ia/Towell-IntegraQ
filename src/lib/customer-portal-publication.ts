export const portalFileFields = "id,resource_id,bucket_id,object_path,original_name,mime_type,size_bytes,workspace_id,external_organization_id,resource_type,deleted_at";
type PortalFile = {
  id: string; resource_id: string; workspace_id: string; external_organization_id: string | null;
  resource_type: string; bucket_id: string; object_path: string; deleted_at: string | null;
};
type Publication = { id: string; file_id: string; customer_id: string | null; publication_scope?: string; workspace_id: string; status: string };

export function matchesPortalPublication(publication: Publication, file: PortalFile, workspace: string, customer: string, administratorPreview = false) {
  const general = publication.publication_scope === "general" && publication.customer_id === null;
  const individual = (publication.publication_scope ?? "individual") === "individual" && publication.customer_id === customer;
  return !!customer && publication.workspace_id === workspace && (general || individual) &&
    (administratorPreview || publication.status === "published") &&
    file.id === publication.file_id && file.resource_id === publication.id &&
    file.workspace_id === workspace && file.external_organization_id === publication.customer_id &&
    file.resource_type === "customer_portal_document" && file.deleted_at === null &&
    file.bucket_id === "integraq-private" && file.object_path.startsWith(`customer-portal/${workspace}/${general ? "general" : customer}/`);
}
