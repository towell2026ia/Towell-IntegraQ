import { auditContext, auditFailure, auditRpcError, loadAuditWorkspace, SupplierAuditError } from "@/lib/supplier-audits/server";
import { validDate, validateSchedule, validateScores } from "@/lib/supplier-audits/model";
export async function GET() {
  try { return Response.json(await loadAuditWorkspace(await auditContext())); } catch (error) { return auditFailure(error); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !["configure", "save", "result", "contacts"].includes(body.command)) throw new SupplierAuditError("Solicitud de auditoría no válida.");
    const context = await auditContext(body.command === "configure" ? "admin" : body.command === "contacts" ? "view" : "manage");
    if (body.command === "contacts" && !context.administrator && !context.canManage) throw new SupplierAuditError("Sólo el inspector o un administrador pueden editar contactos.", 403);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if ((body.command !== "save" || body.id) && reason.length < 5) throw new SupplierAuditError("Indica un motivo de al menos cinco caracteres.");
    let result;
    if (body.command === "configure") {
      if (!Array.isArray(body.inspectorIds) || !Array.isArray(body.legacySupplierIds)) throw new SupplierAuditError("Selecciona identidades y proveedores verificables.");
      result = await context.supabase.rpc("iq_supplier_audit_configure", { p_inspectors: body.inspectorIds, p_legacy_suppliers: body.legacySupplierIds, p_expected_revision: body.revision, p_reason: reason });
    } else if (body.command === "save") {
      try { validateSchedule(body.payload ?? {}); } catch (error) { throw new SupplierAuditError(error instanceof Error ? error.message : "Programación no válida."); }
      result = await context.supabase.rpc("iq_supplier_audit_save", { p_id: body.id ?? null, p_expected_revision: body.revision ?? 0, p_payload: body.payload, p_reason: reason || null });
    } else if (body.command === "result") {
      const input = body.payload ?? {};
      try { validateScores(input.questionnaire, input.scores, input.score); } catch (error) { throw new SupplierAuditError(error instanceof Error ? error.message : "Calificaciones no válidas."); }
      if (!validDate(input.evaluationDate) || !validDate(input.actualDate) || !input.reportId || !input.auditor?.trim()) throw new SupplierAuditError("Completa fecha real, fecha de evaluación, auditor e informe PDF.");
      result = await context.supabase.rpc("iq_supplier_audit_result", { p_event: body.id, p_revision: body.revision, p_result: input, p_finalize: body.finalize === true, p_reason: reason });
    } else {
      result = await context.supabase.rpc("iq_supplier_audit_contacts", { p_supplier: body.id, p_contacts: body.payload, p_expected_updated_at: body.updatedAt, p_reason: reason });
    }
    auditRpcError(result.error); return Response.json({ saved: true, id: result.data });
  } catch (error) { return auditFailure(error); }
}
