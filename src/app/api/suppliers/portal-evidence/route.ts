import { createHash } from "node:crypto";
import { rncpContext, RncpError, type RncpContext } from "@/lib/rncp/server";
import { validRncpFileSignature } from "@/lib/rncp/file-signature";
const bucket = "integraq-private";
const response = (v: unknown, status = 200) =>
  Response.json(v, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
function failure(e: unknown) {
  return response(
    {
      error:
        e instanceof RncpError
          ? e.message
          : "No se pudo completar la operación.",
    },
    e instanceof RncpError ? e.status : 503,
  );
}
async function scope(ctx: RncpContext, event: string, action: string | null) {
  const r = await ctx.supabase.rpc("iq_supplier_portal_evidence_scope", {
    p_event: event,
    p_action: action,
  });
  if (r.error || !r.data)
    throw new RncpError(
      "Expediente o acción no disponible.",
      r.error?.code === "42501" ? 403 : 503,
    );
  return r.data as string;
}
export async function GET(request: Request) {
  try {
    const ctx = await rncpContext("view", true),
      q = new URL(request.url).searchParams,
      event = q.get("event") ?? "",
      file = q.get("file");
    if (q.has("index")) {
      if (!ctx.supplier) throw new RncpError("Acceso no autorizado.", 403);
      const year = q.get("year");
      const result = await ctx.supabase.rpc(
        "iq_supplier_portal_evidence_index",
        {
          p_year: year === "all" ? null : Number(year),
          p_kind: q.get("kind"),
          p_search: q.get("query"),
          p_review: q.get("status"),
          p_offset: Number(q.get("offset") ?? 0),
        },
      );
      if (result.error)
        throw new RncpError(
          "No se pudo consultar la lista de evidencias.",
          result.error.code === "42501" ? 403 : 503,
        );
      return response({ items: result.data ?? [] });
    }
    if (!ctx.supplier && ctx.profile.user_type !== "administrator")
      throw new RncpError("Acceso no autorizado.", 403);
    const org = await scope(ctx, event, null);
    let query = ctx.admin
      .from("supplier_audit_portal_evidence")
      .select(
        "action_key,performed_on,review,observation,file:file_objects!inner(id,original_name,mime_type,object_path,sha256,version,uploaded_by,created_at)",
      )
      .eq("event_id", event)
      .eq("file.resource_id", event)
      .eq("file.workspace_id", org)
      .eq("file.resource_type", "supplier_audit_portal_evidence")
      .eq("file.bucket_id", bucket)
      .is("file.deleted_at", null);
    if (file) query = query.eq("file_id", file);
    const { data, error } = await query.order("performed_on", {
      ascending: false,
    });
    if (error) throw error;
    const items = (data ?? []).flatMap((r) => {
      const f = Array.isArray(r.file) ? r.file[0] : r.file;
      return f
        ? [
            {
              ...f,
              action: r.action_key,
              date: r.performed_on,
              status: r.review,
              note: r.observation,
            },
          ]
        : [];
    });
    if (file) {
      const row = items[0];
      if (!row || !row.object_path.startsWith("supplier-audit-responses/"))
        throw new RncpError("Archivo no autorizado.", 403);
      await scope(ctx, event, row.action);
      const signed = await ctx.admin.storage
        .from(bucket)
        .createSignedUrl(
          row.object_path,
          60,
          q.get("download") === "1"
            ? { download: row.original_name }
            : undefined,
        );
      if (signed.error || !signed.data) throw new Error();
      return response({ url: signed.data.signedUrl });
    }
    return response({
      items: items.map((r) => ({
        id: r.id,
        name: r.original_name,
        date: r.date,
        action: r.action,
        status: r.status,
        note: r.note,
        version: r.version,
      })),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("Content-Type")?.includes("application/json")) {
      const ctx = await rncpContext("admin"),
        body = await request.json();
      const review = await ctx.supabase.rpc(
        "iq_supplier_portal_evidence_review",
        {
          p_file: body.file,
          p_expected: "pending",
          p_decision: body.decision,
          p_note: body.note ?? "",
        },
      );
      if (review.error)
        throw new RncpError(
          "No se confirmó la revisión. Actualiza el expediente.",
          review.error.code === "42501" ? 403 : 409,
        );
      return response({ saved: true });
    }
    const ctx = await rncpContext("view", true);
    if (!ctx.supplier)
      throw new RncpError("La carga requiere una cuenta de proveedor.", 403);
    if (Number(request.headers.get("Content-Length")) > 4 * 1024 * 1024 + 65536)
      throw new RncpError("El archivo supera el tamaño permitido.", 413);
    const form = await request.formData(),
      file = form.get("file"),
      event = String(form.get("event") ?? ""),
      action = String(form.get("action") ?? ""),
      date = String(form.get("date") ?? "");
    if (
      !action ||
      action.length > 200 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      date > new Date().toISOString().slice(0, 10) ||
      !(file instanceof File) ||
      file.size < 1 ||
      file.size > 4194304 ||
      file.name.length > 240
    )
      throw new RncpError("Comprueba la acción, la fecha y el archivo.", 400);
    await scope(ctx, event, action);
    const bytes = new Uint8Array(await file.arrayBuffer()),
      mime = file.type;
    if (!validRncpFileSignature(bytes, mime))
      throw new RncpError("Formato no autorizado.", 400);
    const sha = createHash("sha256").update(bytes).digest("hex"),
      key = createHash("sha256").update(action).digest("hex");
    const reservation = await ctx.supabase.rpc(
      "iq_supplier_portal_prepare_upload",
      {
        p_event: event,
        p_action: action,
        p_date: date,
        p_sha: sha,
        p_mime: mime,
        p_bytes: file.size,
      },
    );
    if (reservation.error)
      throw new RncpError(
        "No se pudo reservar el archivo para esta acción.",
        reservation.error.code === "42501" ? 403 : 409,
      );
    const path = [
      "supplier-audit-responses",
      ctx.profile.id,
      event,
      key,
      date,
      sha,
    ].join("/");
    const uploaded = await ctx.admin.storage
      .from(bucket)
      .upload(path, bytes, { upsert: false, contentType: mime });
    if (
      uploaded.error &&
      !["409", "Duplicate"].includes(
        String(uploaded.error.statusCode ?? uploaded.error.name),
      ) &&
      !/already exists/i.test(uploaded.error.message)
    )
      throw new Error();
    const r = await ctx.supabase.rpc("iq_supplier_portal_evidence_add", {
      p_event: event,
      p_action: action,
      p_date: date,
      p_sha: sha,
      p_name: file.name,
      p_mime: mime,
      p_bytes: file.size,
    });
    if (r.error)
      throw new RncpError(
        "El vínculo no se confirmó. Comprueba el acceso y reintenta con el mismo archivo.",
        r.error.code === "42501" ? 403 : 409,
      );
    return response({ id: r.data });
  } catch (e) {
    return failure(e);
  }
}
