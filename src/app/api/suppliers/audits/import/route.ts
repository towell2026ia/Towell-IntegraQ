import { createHash } from "node:crypto";
import { auditContext, auditFailure, auditRpcError, auditSettings, auditSuppliers, SupplierAuditError } from "@/lib/supplier-audits/server";
import { parseAuditProgram, matchAuditSupplier } from "@/lib/supplier-audits/import";
export async function POST(request: Request) {
  try {
    const context = await auditContext("manage"), form = await request.formData(), file = form.get("file"), mode = form.get("mode");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size < 1 || file.size > 4194304 || !["preview", "commit"].includes(String(mode))) throw new SupplierAuditError("Selecciona el F-CA-58 original, máximo 4 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer()), sha = createHash("sha256").update(bytes).digest("hex");
    const source = parseAuditProgram(bytes, sha), settings = await auditSettings(context), suppliers = await auditSuppliers(context, settings.settings);
    const rows = source.map(row => ({ ...row, supplierId: matchAuditSupplier(row.supplierName, suppliers) }));
    if (mode === "preview") return Response.json({ sha256: sha, total: rows.length, matched: rows.filter(r => r.supplierId).length, pending: rows.filter(r => !r.supplierId).length,
      rows: rows.map(({ sourcePayload: _source, ...row }) => { void _source; return row; }) });
    if (form.get("confirmedSha256") !== sha) throw new SupplierAuditError("Revisa nuevamente el mismo archivo antes de confirmar.", 409);
    const result = await context.supabase.rpc("iq_supplier_audit_import", { p_sha: sha, p_rows: rows }); auditRpcError(result.error);
    return Response.json(result.data);
  } catch (error) { return auditFailure(error); }
}
