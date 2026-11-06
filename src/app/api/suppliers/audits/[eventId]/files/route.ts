import { createHash } from "node:crypto";
import { auditContext, auditEvent, auditFailure, auditRpcError, auditSettings, auditSuppliers, SupplierAuditError } from "@/lib/supplier-audits/server";
import { verifyAuditPdf } from "@/lib/supplier-audits/pdf";
export const maxDuration = 30;
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const context = await auditContext("manage"), { eventId } = await params, event = await auditEvent(context, eventId);
    const settings = await auditSettings(context), suppliers = await auditSuppliers(context, settings.settings);
    if (!event.supplier_id || !suppliers.some(s => s.id === event.supplier_id)) throw new SupplierAuditError("Confirma la asociación del proveedor antes de adjuntar archivos.", 403);
    const form = await request.formData(), file = form.get("file"), type = form.get("type"), reason = String(form.get("reason") ?? "").trim();
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf") || !file.size || file.size > 4194304 || !["supplier_audit_report", "supplier_audit_action_plan"].includes(String(type)) || reason.length < 5) throw new SupplierAuditError("Selecciona un PDF de hasta 4 MB e indica el motivo.");
    const revision = Number(form.get("revision")); if (revision !== event.revision) throw new SupplierAuditError("El expediente cambió. Actualiza antes de adjuntar.", 409);
    if (event.state === "cancelled") throw new SupplierAuditError("La auditoría está cancelada.", 409);
    const policy = await context.admin.from("file_upload_policies").select("max_size_bytes,allowed_mime_types").eq("resource_type", type).maybeSingle(); auditRpcError(policy.error);
    if (!policy.data || file.size > policy.data.max_size_bytes || !policy.data.allowed_mime_types.includes("application/pdf")) throw new SupplierAuditError("La política de carga no permite este archivo.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    try { await verifyAuditPdf(bytes); } catch { throw new SupplierAuditError("El archivo no contiene un PDF consultable o requiere una contraseña. Carga un informe PDF legible."); }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const existing = await context.admin.from("file_objects").select("id").eq("resource_id", event.id).eq("resource_type", type).eq("workspace_id", context.organizationId).eq("sha256", hash).is("deleted_at", null).maybeSingle(); auditRpcError(existing.error);
    if (existing.data) return Response.json({ fileId: existing.data.id, duplicate: true });
    const name = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]/g, "-").slice(-160);
    const path = `${context.session.authUserId}/supplier-audits/${event.id}/${crypto.randomUUID()}/${name}`;
    const upload = await context.admin.storage.from("integraq-private").upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (upload.error) throw new SupplierAuditError("No se pudo almacenar el informe PDF.", 503);
    const registered = await context.supabase.rpc("iq_supplier_audit_file", { p_event: event.id, p_revision: revision,
      p_file: { type, path, name: file.name, mime: "application/pdf", size: file.size, sha256: hash, reason } });
    // No physical deletion on failure. An unlinked private upload is never presented as attached.
    auditRpcError(registered.error); return Response.json({ fileId: registered.data, duplicate: false });
  } catch (error) { return auditFailure(error); }
}
