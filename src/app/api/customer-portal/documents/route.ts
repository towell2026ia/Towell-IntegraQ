import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerPortalDate, resolveCustomerPortalActor } from "@/lib/customer-portal-server";
import { publishedCertificationFiles } from "@/lib/certification-portal-server";

const documentFields = "id,folder_id,display_name,original_name,mime_type,size_bytes,reference_type,validity_status,valid_from,valid_until,description,version,is_current,deleted_at,created_at";

export async function GET() {
  const session = await getAuthenticatedSession();
  const actor = await resolveCustomerPortalActor(session);
  if (!actor) return NextResponse.json({ error: "Acceso al Portal de Clientes no autorizado." }, { status: 403 });

  const admin = createAdminClient();
  let query = admin.from("file_objects").select(documentFields)
    .eq("workspace_id", actor.workspaceId)
    .eq("resource_type", "general_information_document")
    .eq("is_current", true).is("deleted_at", null)
    .order("display_name", { ascending: true });
  if (actor.kind === "customer") {
    query = query.eq("reference_type", "external").eq("validity_status", "current");
  }
  const result = await query;
  if (result.error) return NextResponse.json({ error: "No fue posible consultar los documentos autorizados." }, { status: 500 });
  const today = customerPortalDate();
  const documents = (result.data ?? []).filter(row => row.is_current && !row.deleted_at &&
    (actor.kind === "administrator" || (row.reference_type === "external" && row.validity_status === "current" &&
      (!row.valid_from || row.valid_from <= today) && (!row.valid_until || row.valid_until >= today)))).map(row => ({
        id: row.id, folderId: row.folder_id, name: row.display_name || row.original_name, originalName: row.original_name,
        mimeType: row.mime_type || "application/octet-stream", sizeBytes: row.size_bytes ?? 0,
        referenceType: row.reference_type, validityStatus: row.validity_status,
        validFrom: row.valid_from, validUntil: row.valid_until, description: row.description,
        version: row.version ?? 1, createdAt: row.created_at,
      }));

  // Only an explicitly published certificate's current files enter the existing Documents section.
  try {
    const certificationFiles = await publishedCertificationFiles(actor);
    documents.push(...certificationFiles.map(file => ({
      id:file.id,folderId:null,name:file.certification_name,originalName:file.original_name,
      mimeType:file.mime_type,sizeBytes:file.size_bytes,referenceType:"external",validityStatus:"current",
      validFrom:null,validUntil:null,description:"Certificación publicada",version:file.version,createdAt:file.created_at,
      fileHref:`/api/customer-portal/certifications/${file.id}`,managedInCertifications:true,
    })));
  } catch {
    return NextResponse.json({error:"No fue posible consultar las certificaciones autorizadas. Reintenta."},{status:500,headers:{"Cache-Control":"private, no-store"}});
  }
  if (actor.kind === "administrator") {
    const folders = await admin.from("document_folders").select("id,name")
      .eq("workspace_id", actor.workspaceId).is("deleted_at", null).is("archived_at", null).order("name");
    if (folders.error) return NextResponse.json({ error: "No fue posible consultar las carpetas documentales." }, { status: 500 });
    return NextResponse.json({ documents, folders: folders.data ?? [] },{headers:{"Cache-Control":"private, no-store"}});
  }
  return NextResponse.json({ documents },{headers:{"Cache-Control":"private, no-store"}});
}
