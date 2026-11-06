import { NextResponse } from "next/server";
import { loadMatrixReports, rncpContext, RncpError } from "@/lib/rncp/server";

export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const context = await rncpContext("view", true); const { fileId } = await params;
    const result = await context.admin.from("file_objects").select("id,workspace_id,resource_id,resource_type,bucket_id,object_path,deleted_at,original_name").eq("id", fileId).in("resource_type", ["supplier_rncp_original", "supplier_rncp_import_pending"]).maybeSingle();
    const file = result.data;
    if (result.error || !file || file.deleted_at) throw new RncpError("Archivo no autorizado.", 403);
    if (file.resource_type === "supplier_rncp_import_pending") {
      if (context.profile.user_type !== "administrator" || file.workspace_id !== context.organizationId) throw new RncpError("Archivo pendiente exclusivo de administración.", 403);
    } else {
      if (!file.resource_id) throw new RncpError("Referencia documental incompleta.", 409);
      const reports = await loadMatrixReports(context, file.resource_id);
      if (file.workspace_id !== reports[0].organizationId || file.bucket_id !== "integraq-private" || !file.object_path.startsWith(`rncp-originals/${reports[0].organizationId}/`)) throw new RncpError("Referencia de archivo incompatible con el expediente.", 403);
    }
    if (file.bucket_id !== "integraq-private" || !file.object_path.startsWith(`rncp-originals/${file.workspace_id}/`)) throw new RncpError("Ruta de original no autorizada.", 403);
    const signed = await context.admin.storage.from(file.bucket_id).createSignedUrl(file.object_path, 60, new URL(request.url).searchParams.get("download") === "1" ? { download: file.original_name } : undefined);
    if (signed.error || !signed.data) throw new RncpError("No se pudo abrir el archivo original.", 503);
    return NextResponse.json({ url: signed.data.signedUrl, expiresIn: 60 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible consultar el archivo." }, { status: error instanceof RncpError ? error.status : 500 }); }
}
