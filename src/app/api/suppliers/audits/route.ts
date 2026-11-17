import { assertAuditWritable, auditEvent, auditContext, auditFailure, auditRpcError, auditSuppliers, loadAuditWorkspace, SupplierAuditError } from "@/lib/supplier-audits/server";
import { validDate, validateSchedule, validateScores } from "@/lib/supplier-audits/model";
import { canWithdrawAudit, withdrawalInput } from "@/lib/supplier-audits/withdrawal";
import { validateSupplierContacts } from "@/lib/supplier-audits/contacts";
export async function GET() {
  try { return Response.json(await loadAuditWorkspace(await auditContext())); } catch (error) { return auditFailure(error); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !["save", "result", "contacts", "withdraw", "restore"].includes(body.command)) throw new SupplierAuditError("Solicitud de auditoría no válida.");
    const withdrawal = body.command === "withdraw" || body.command === "restore";
    const context = await auditContext(withdrawal ? "admin" : body.command === "contacts" ? "view" : "manage");
    if (withdrawal) {
      if (!context.administrator || !context.canManage) throw new SupplierAuditError("Se requiere un administrador con permiso de edición de Proveedores.", 403);
      if (!canWithdrawAudit(context)) throw new SupplierAuditError("Retiro pendiente de activación del SQL específico autorizado. No se modificó ningún registro.", 503);
      let input;
      try { input = withdrawalInput(body); } catch (error) { throw new SupplierAuditError((error as Error).message); }
      const changed = await context.supabase.rpc("iq_supplier_audit_set_withdrawn", {
        p_event: input.id, p_expected_revision: input.revision, p_withdrawn: input.withdrawn, p_reason: input.reason,
      });
      auditRpcError(changed.error);
      if (!changed.data || changed.data.id !== input.id || changed.data.revision !== input.revision + 1 || Boolean(changed.data.withdrawn_at) !== input.withdrawn) {
        throw new SupplierAuditError("No se pudo verificar la confirmación. Consulta el expediente antes de reintentar.", 503);
      }
      return Response.json({ saved: true, ...changed.data }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (body.command === "contacts" && !context.administrator && !context.canManage) throw new SupplierAuditError("Sólo el inspector o un administrador pueden editar contactos.", 403);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if ((body.command !== "save" || body.id) && reason.length < 5) throw new SupplierAuditError("Indica un motivo de al menos cinco caracteres.");
    let result;
    if (body.command === "save") {
      try { validateSchedule(body.payload ?? {}); } catch (error) { throw new SupplierAuditError(error instanceof Error ? error.message : "Programación no válida."); }
      if (body.id) assertAuditWritable(await auditEvent(context, body.id));
      result = await context.supabase.rpc("iq_supplier_audit_save", { p_id: body.id ?? null, p_expected_revision: body.revision ?? 0, p_payload: body.payload, p_reason: reason || null });
    } else if (body.command === "result") {
      const input = body.payload ?? {};
      try { validateScores(input.questionnaire, input.scores, input.score); } catch (error) { throw new SupplierAuditError(error instanceof Error ? error.message : "Calificaciones no válidas."); }
      if (!validDate(input.evaluationDate) || !validDate(input.actualDate) || !input.reportId || !input.auditor?.trim()) throw new SupplierAuditError("Completa fecha real, fecha de evaluación, auditor e informe PDF.");
      assertAuditWritable(await auditEvent(context, body.id));
      result = await context.supabase.rpc("iq_supplier_audit_result", { p_event: body.id, p_revision: body.revision, p_result: input, p_finalize: body.finalize === true, p_reason: reason });
    } else {
      if (!body.id || !body.updatedAt) throw new SupplierAuditError("Recarga el proveedor antes de guardar contactos.", 409);
      if (process.env.SUPPLIER_CONTACTS_V2_ENABLED === "true") {
        let contacts;
        try { contacts = validateSupplierContacts(body.payload?.contacts); } catch (error) { throw new SupplierAuditError((error as Error).message); }
        result = await context.supabase.rpc("iq_supplier_audit_contacts_v2", { p_supplier: body.id, p_contacts: { contacts }, p_expected_updated_at: body.updatedAt, p_reason: reason });
      } else {
        if (body.payload?.contacts !== undefined) throw new SupplierAuditError("La edición de múltiples contactos aún no está activada. Usa el formulario actual.", 503);
        const supplier = (await auditSuppliers(context)).find(item => item.id === body.id);
        if (!supplier) throw new SupplierAuditError("Proveedor fuera del catálogo autorizado.", 403);
        const existing = supplier.metadata?.supplierQualityContacts as { contacts?: unknown } | null;
        if (Array.isArray(existing?.contacts) && existing.contacts.length) throw new SupplierAuditError("Este proveedor ya tiene contactos múltiples; activa la RPC V2 antes de editar para conservarlos.", 503);
        result = await context.supabase.rpc("iq_supplier_audit_contacts", { p_supplier: body.id, p_contacts: body.payload, p_expected_updated_at: body.updatedAt, p_reason: reason });
      }
    }
    if (body.command === "contacts" && process.env.SUPPLIER_CONTACTS_V2_ENABLED === "true" && result.error && ["PGRST202", "42883"].includes(result.error.code ?? "")) throw new SupplierAuditError("La edición de múltiples contactos está pendiente de activar en la base de datos. No se guardó ningún cambio.", 503);
    auditRpcError(result.error); return Response.json({ saved: true, id: result.data });
  } catch (error) { return auditFailure(error); }
}
