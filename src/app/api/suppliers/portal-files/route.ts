import { rncpContext, RncpError } from "@/lib/rncp/server";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const ctx = await rncpContext("view", true);
    if (!ctx.supplier) throw new RncpError("Acceso no autorizado.", 403);
    const query = new URL(request.url).searchParams,
      id = query.get("report"),
      file = query.get("file");
    const result = await ctx.supabase.rpc("iq_supplier_portal_report_files", {
      p_report: id,
    });
    if (result.error)
      throw new RncpError(
        "No se pudieron consultar los archivos.",
        result.error.code === "42501" ? 403 : 503,
      );
    const files = (result.data ?? []) as {
      id: string;
      name: string;
      kind: string;
    }[];
    if (!file) return Response.json({ files }, { headers });
    const item = files.find((f) => f.id === file);
    if (!item) throw new RncpError("Archivo no autorizado.", 403);
    const stored = await ctx.admin
      .from("file_objects")
      .select("object_path")
      .eq("id", file)
      .eq("resource_id", id)
      .eq("resource_type", item.kind)
      .eq("bucket_id", "integraq-private")
      .is("deleted_at", null)
      .single();
    if (stored.error || !stored.data)
      throw new RncpError("Archivo no disponible.", 403);
    const signed = await ctx.admin.storage
      .from("integraq-private")
      .createSignedUrl(
        stored.data.object_path,
        60,
        query.get("download") === "1" ? { download: item.name } : undefined,
      );
    if (signed.error || !signed.data) throw new Error();
    return Response.json({ url: signed.data.signedUrl }, { headers });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof RncpError
            ? e.message
            : "No se pudo consultar el documento.",
      },
      { status: e instanceof RncpError ? e.status : 503, headers },
    );
  }
}
