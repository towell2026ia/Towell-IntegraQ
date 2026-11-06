import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { parseHistoricalMatrix, reconcileSupplier, type SupplierIdentity } from "@/lib/rncp/import";
import { paginatedRows, rncpContext, RncpError } from "@/lib/rncp/server";

export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    const context = await rncpContext("admin");
    const form = await request.formData();
    const file = form.get("file"), mode = form.get("mode");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size < 1 || file.size > 4 * 1024 * 1024) throw new RncpError("Selecciona el Excel F-CA-24 original, máximo 4 MB.");
    if (mode !== "preview" && mode !== "commit") throw new RncpError("Confirma primero la vista previa de la importación.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    const source = parseHistoricalMatrix(bytes, hash);
    const suppliers = await paginatedRows<SupplierIdentity & { owning_organization_id: string | null }>((from, to) => context.admin.from("organizations").select("id,code,name,active,owning_organization_id", { count: "exact" }).eq("kind", "supplier").or(`owning_organization_id.is.null,owning_organization_id.eq.${context.organizationId}`).order("id").range(from, to));
    const rows = source.map(row => { const match = reconcileSupplier(row, suppliers), supplier = suppliers.find(candidate => candidate.id === match.supplierId);
      return { ...row, ...match, targetSupplierName: supplier?.name ?? null, targetSupplierCode: supplier?.code ?? null }; });
    const existing = await context.admin.from("supplier_rncp_reports").select("folio,source_sha256,organization_id").in("folio", rows.map(r => r.folio));
    if (existing.error) throw new RncpError("No se pudieron verificar los folios existentes; no se importó nada.", 503);
    const conflicts = (existing.data ?? []).filter(row => row.source_sha256 !== hash || row.organization_id !== context.organizationId);
    if (conflicts.length) throw new RncpError(`Conflicto con ${conflicts.length} folios existentes. No se modificó ningún registro.`, 409);
    if (mode === "preview") return NextResponse.json({ sha256: hash, total: rows.length, matched: rows.filter(r => !r.pending).length,
      pending: rows.filter(r => r.pending).length, existing: existing.data?.length ?? 0,
      rows: rows.map(({ original: _original, ...row }) => { void _original; return row; }), notificationsGenerated: 0 });
    if (form.get("confirmedSha256") !== hash) throw new RncpError("El archivo cambió después de la vista previa. Repite la revisión.", 409);
    const result = await context.supabase.rpc("iq_rncp_import_history", { p_sha256: hash,
      p_rows: rows.map(row => ({ ...row, reconciliationMethod: row.method })) });
    if (result.error) throw new RncpError(`La importación se detuvo de forma transaccional (${result.error.code ?? "verificación"}). No se sobrescribieron registros.`, 409);
    return NextResponse.json({ ...result.data, sha256: hash, notificationsGenerated: 0 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible importar MATRIZ." }, { status: error instanceof RncpError ? error.status : 400 }); }
}
