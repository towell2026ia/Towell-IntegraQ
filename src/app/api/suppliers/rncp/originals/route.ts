import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { parsePdfRncpIdentity, readRncpPdf } from "@/lib/rncp/pdf";
import { canonicalSupplierCode } from "@/lib/rncp/import";
import { paginatedRows, rncpContext, RncpError } from "@/lib/rncp/server";

export const maxDuration = 30;
export async function GET() {
  try {
    const context = await rncpContext("admin");
    const files = await paginatedRows<{ id: string }>((from, to) => context.admin.from("file_objects").select("id,original_name,resource_key,sha256,created_at,observations", { count: "exact" }).eq("workspace_id", context.organizationId).eq("resource_type", "supplier_rncp_import_pending").is("deleted_at", null).order("id").range(from, to));
    return NextResponse.json({ files });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const context = await rncpContext("admin");
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File) || !/\.pdf$/i.test(file.name) || file.size < 8 || file.size > 5 * 1024 * 1024) throw new RncpError("Cada original debe ser un PDF de hasta 5 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const duplicate = await context.admin.from("file_objects").select("id,resource_id").eq("workspace_id", context.organizationId).eq("sha256", sha256).in("resource_type", ["supplier_rncp_original", "supplier_rncp_import_pending"]).is("deleted_at", null).maybeSingle();
    if (duplicate.error) throw new RncpError("No se pudo comprobar si el PDF ya existe.", 503);
    if (duplicate.data) return NextResponse.json({ state: "duplicate", fileId: duplicate.data.id, reportId: duplicate.data.resource_id, reportCreated: false });
    const identity = parsePdfRncpIdentity(await readRncpPdf(bytes), file.name);
    let reportId: string | null = null; let pendingReason = identity.ambiguous ? "Identidad documental no verificable automáticamente" : "Folio no registrado en la matriz";
    if (!identity.ambiguous && identity.folio) {
      const report = await context.admin.from("supplier_rncp_reports").select("id,supplier_id,historical_supplier_code").eq("organization_id", context.organizationId).eq("folio", identity.folio).is("deleted_at", null).maybeSingle();
      if (report.error) throw new RncpError("No se pudo verificar el folio del PDF.", 503);
      if (report.data?.supplier_id) {
        const supplier = await context.admin.from("organizations").select("id,code").eq("id", report.data.supplier_id).eq("kind", "supplier").maybeSingle();
        if (supplier.error) throw new RncpError("No se pudo verificar el proveedor.", 503);
        const codes = [supplier.data?.code, report.data.historical_supplier_code].filter(Boolean) as string[];
        if (codes.some(code => canonicalSupplierCode(code) === canonicalSupplierCode(identity.supplierCode!))) reportId = report.data.id;
        else pendingReason = "El proveedor del PDF no coincide con el expediente";
      } else if (report.data) pendingReason = "Proveedor pendiente de conciliación";
    }
    const id = crypto.randomUUID();
    const path = `rncp-originals/${context.organizationId}/${context.profile.id}/${id}/${file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-140)}`;
    const uploaded = await context.admin.storage.from("integraq-private").upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (uploaded.error) throw new RncpError("No se pudo guardar el PDF privado.", 503);
    const result = await context.supabase.rpc("iq_rncp_register_original", { p_report_id: reportId,
      p_file: { id, name: file.name, path, sizeBytes: file.size, sha256, mimeType: "application/pdf", identity: { ...identity, pendingReason: reportId ? null : pendingReason } } });
    // Preserve original bytes even when registration fails; never delete an original as compensation.
    if (result.error) throw new RncpError(`El archivo se conservó privado, pero no se confirmó su registro. Referencia ${id}; consulta antes de volver a cargarlo.`, 409);
    return NextResponse.json({ ...result.data, folio: identity.folio, supplierCode: identity.supplierCode, pendingReason: reportId ? null : pendingReason, reportCreated: false });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const context = await rncpContext("admin"); const body = await request.json();
    if (!/^[a-f0-9-]{36}$/i.test(String(body.fileId ?? ""))) throw new RncpError("Identificador de archivo inválido.");
    const pending = await context.admin.from("file_objects").select("observations").eq("id", body.fileId)
      .eq("workspace_id", context.organizationId).eq("resource_type", "supplier_rncp_import_pending").is("deleted_at", null).maybeSingle();
    if (pending.error || !pending.data) throw new RncpError("El pendiente ya no está disponible.", 409);
    let identity: { folio?: string; ambiguous?: boolean };
    try { identity = typeof pending.data.observations === "string" ? JSON.parse(pending.data.observations) : pending.data.observations; }
    catch { throw new RncpError("No hay identidad documental verificable para conciliar.", 409); }
    if (!identity?.folio || identity.ambiguous) throw new RncpError("La identidad del PDF requiere revisión documental.", 409);
    const report = await context.admin.from("supplier_rncp_reports").select("id").eq("organization_id", context.organizationId)
      .eq("folio", identity.folio).is("deleted_at", null).maybeSingle();
    if (report.error || !report.data || (body.reportId && body.reportId !== report.data.id)) throw new RncpError("El folio aún no tiene un expediente único autorizado.", 409);
    const result = await context.supabase.rpc("iq_rncp_reconcile_original", { p_file_id: body.fileId, p_report_id: report.data.id });
    if (result.error) throw new RncpError("El folio o el proveedor todavía no permiten una asociación verificada.", 409);
    return NextResponse.json({ linked: true, reportCreated: false });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible registrar el PDF." }, { status: error instanceof RncpError ? error.status : 400 }); }
