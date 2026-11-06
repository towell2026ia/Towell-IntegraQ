import { auditContext, auditEvent, auditFailure, auditRpcError, SupplierAuditError } from "@/lib/supplier-audits/server";
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string; fileId: string }> }) {
  try {
    const context = await auditContext(), { eventId, fileId } = await params, event = await auditEvent(context, eventId);
    const file = await context.admin.from("file_objects").select("bucket_id,object_path,original_name,external_organization_id").eq("id", fileId).eq("resource_id", event.id).eq("workspace_id", context.organizationId).in("resource_type", ["supplier_audit_report", "supplier_audit_action_plan"]).eq("audience", "internal").is("deleted_at", null).maybeSingle(); auditRpcError(file.error);
    if (!file.data || file.data.external_organization_id !== event.supplier_id) throw new SupplierAuditError("Archivo no autorizado para este expediente.", 404);
    const download = new URL(request.url).searchParams.get("download") === "true";
    const signed = await context.admin.storage.from(file.data.bucket_id).createSignedUrl(file.data.object_path, 60, download ? { download: file.data.original_name } : undefined);
    if (signed.error || !signed.data) throw new SupplierAuditError("El archivo físico no está disponible.", 503);
    return Response.json({ signedUrl: signed.data.signedUrl, expiresIn: 60 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return auditFailure(error); }
}
