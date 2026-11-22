import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchesPortalPublication, portalFileFields } from "@/lib/customer-portal-publication";
import { certificationUuid } from "@/lib/customer-certifications";
import { PublicationUnavailable, requireIndividualPublication } from "@/lib/customer-portal-contract-server";
import type { PortalReader } from "@/lib/customer-portal-link-server";

export async function documentFile(actor: PortalReader, request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!actor) return NextResponse.json({ error: "Acceso al Portal de Clientes no autorizado." }, { status: 403, headers });
  const unavailable = () => NextResponse.json({ error: "Documento no disponible." }, { status: 404, headers });
  const { documentId } = await params;
  const query = new URL(request.url).searchParams;
  const administratorPreview = actor.kind === "administrator" && query.get("admin") === "1";
  const customer = administratorPreview ? query.get("customerId") : actor.companyId;
  if (!customer || !certificationUuid.test(customer) || !certificationUuid.test(documentId)) return unavailable();
  try {
    await requireIndividualPublication();
  } catch (error) {
    return NextResponse.json({ error: error instanceof PublicationUnavailable ? error.message : "No fue posible verificar el acceso documental." }, { status: 503, headers });
  }
  const db = createAdminClient();
  let lookup = db.from("customer_portal_document_publications").select("id,file_id,customer_id,workspace_id,status")
    .eq("id", documentId).eq("workspace_id", actor.workspaceId).eq("customer_id", customer);
  if (!administratorPreview) lookup = lookup.eq("status", "published");
  const publication = await lookup.maybeSingle();
  const row = publication.data;
  if (publication.error || !row?.file_id || row.id !== documentId) return unavailable();
  const fileResult = await db.from("file_objects").select(portalFileFields)
    .eq("id", row.file_id).eq("workspace_id", actor.workspaceId).eq("external_organization_id", customer)
    .eq("resource_type", "customer_portal_document").eq("bucket_id", "integraq-private").is("deleted_at", null).maybeSingle();
  const file = fileResult.data;
  if (fileResult.error || !file || !matchesPortalPublication(row, file, actor.workspaceId, customer, administratorPreview)) return unavailable();
  const download = query.get("disposition") === "download";
  const audit = await db.from("customer_portal_document_events").insert({ publication_id: documentId, workspace_id: actor.workspaceId,
    customer_id: customer, actor_id: actor.userId, ...("linkId" in actor ? {portal_link_id: actor.linkId} : {}), action: "accessed", after_value: { fileId: file.id, disposition: download ? "download" : "view" } });
  if (audit.error) return NextResponse.json({ error: "No fue posible registrar la consulta del documento." }, { status: 500, headers });
  const signed = await db.storage.from("integraq-private").createSignedUrl(file.object_path, 60, download ? { download: file.original_name } : { download: false });
  if (signed.error || !signed.data) return NextResponse.json({ error: "No fue posible abrir el archivo autorizado." }, { status: 500, headers });
  if ("linkId" in actor) return NextResponse.json({url: signed.data.signedUrl}, {headers});
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers });
}
