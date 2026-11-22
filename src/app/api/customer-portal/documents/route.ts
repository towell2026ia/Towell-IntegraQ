import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCustomerPortalActor, type CustomerPortalActor } from "@/lib/customer-portal-server";
import { publishedCertificationFiles } from "@/lib/certification-portal-server";
import { matchesPortalPublication, portalFileFields } from "@/lib/customer-portal-publication";

import { PublicationUnavailable, requireIndividualPublication } from "@/lib/customer-portal-contract-server";

async function customerDocuments(actor: CustomerPortalActor) {
  if (actor.kind !== "customer" || !actor.companyId) return [];
  await requireIndividualPublication();
  const customer = actor.companyId;
  const admin = createAdminClient();
  const documents: Array<{id:string; name:string; originalName:string; mimeType:string; sizeBytes:number;
    referenceType:string; validityStatus:string; description:string | null; version:number; createdAt:string}> = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const publications = await admin.from("customer_portal_document_publications")
      .select("id,workspace_id,customer_id,display_name,description,version,published_at,file_id,status")
      .eq("workspace_id", actor.workspaceId).eq("customer_id", customer).eq("status", "published")
      .order("published_at", { ascending: false }).order("id").range(offset, offset + pageSize - 1);
    if (publications.error) throw publications.error;
    const rows = publications.data ?? [];
    if (!rows.length) break;
    const files = await admin.from("file_objects").select(portalFileFields)
      .eq("workspace_id", actor.workspaceId).eq("external_organization_id", customer)
      .eq("resource_type", "customer_portal_document").eq("bucket_id", "integraq-private")
      .in("id", rows.map(row => row.file_id)).is("deleted_at", null);
    if (files.error) throw files.error;
    const byId = new Map((files.data ?? []).map(file => [file.id, file]));
    for (const row of rows) {
      const file = byId.get(row.file_id);
      if (!file || !matchesPortalPublication(row, file, actor.workspaceId, customer)) continue;
      documents.push({ id: row.id, name: row.display_name, originalName: file.original_name, mimeType: file.mime_type,
        sizeBytes: file.size_bytes, referenceType: "external", validityStatus: "current",
        description: row.description, version: row.version, createdAt: row.published_at });
    }
    if (rows.length < pageSize) break;
  }
  return documents;
}

export async function GET() {
  const actor = await resolveCustomerPortalActor(await getAuthenticatedSession());
  const headers = { "Cache-Control": "private, no-store" };
  if (!actor) return NextResponse.json({ error: "Acceso al Portal de Clientes no autorizado." }, { status: 403, headers });
  const [publications, certifications] = await Promise.allSettled([customerDocuments(actor), publishedCertificationFiles(actor)]);
  const documents = publications.status === "fulfilled" ? publications.value : [];
  const certificates = certifications.status === "fulfilled" ? certifications.value.map(file => ({
    id: file.id, name: file.certification_name, originalName: file.original_name, mimeType: file.mime_type,
    sizeBytes: file.size_bytes, referenceType: "external", validityStatus: "current",
    description: "Certificación publicada", version: file.version, createdAt: file.created_at,
    fileHref: `/api/customer-portal/certifications/${file.id}`, managedInCertifications: true,
  })) : [];
  return NextResponse.json({ documents: [...documents, ...certificates], sectionErrors: {
    documents: publications.status === "rejected" ? (publications.reason instanceof PublicationUnavailable ? publications.reason.message : "Documentos: no se pudo verificar la publicación por destinatario.") : null,
    certifications: certifications.status === "rejected" ? "Certificaciones: no se pudieron verificar las certificaciones autorizadas." : null,
  } }, { headers });
}
