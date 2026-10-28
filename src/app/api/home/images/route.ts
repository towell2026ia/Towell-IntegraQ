import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { homeImageMime, isHomeImageSlot, maximumHomeImageBytes, parseHomeImageRevision } from "@/lib/home-image-slots";
import { HomeImageBodyTooLarge, readHomeImageForm } from "@/lib/home-image-upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const bucket = "integraq-home-images";
const headers = { "Cache-Control": "private, no-store" };
function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers });
}
async function context() {
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  const profile = await client.from("profiles").select("id,user_type,status,organization_id,workspace_mode").eq("id", data.claims.sub).single();
  if (profile.error || !profile.data || profile.data.status !== "active" || !profile.data.organization_id) return null;
  return { client, profile: profile.data };
}
export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return fail("Sesión no válida.", 401);
  const admin = ctx.profile.user_type === "administrator";
  const requestedVersion = new URL(request.url).searchParams.get("version");
  if (requestedVersion && !admin) return fail("Solo el administrador puede consultar versiones anteriores.", 403);
  if (requestedVersion && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedVersion)) return fail("Versión no válida.", 400);
  let query = ctx.client.from("home_image_versions").select("id,slot,revision,object_path,file_name,created_at,reason").eq("organization_id", ctx.profile.organization_id).eq("workspace_mode", ctx.profile.workspace_mode ?? "production").order("revision", { ascending: false });
  if (requestedVersion) query = query.eq("id", requestedVersion);
  const result = await query;
  if (result.error) return fail("No fue posible cargar las imágenes. La configuración puede estar pendiente de habilitarse.", 503);
  if (requestedVersion && !result.data?.length) return fail("La versión no está disponible en este espacio.", 404);
  const signer = createAdminClient();
  const seen = new Set<string>();
  const versions = [];
  for (const row of result.data ?? []) {
    const latest = !seen.has(row.slot);
    seen.add(row.slot);
    if (!admin && !latest) continue;
    let url: string | undefined;
    if (latest) {
      const signed = await signer.storage.from(bucket).createSignedUrl(row.object_path, 600);
      if (signed.error) return fail("No fue posible abrir una imagen guardada.", 503);
      url = signed.data.signedUrl;
    }
    versions.push({ id: row.id, slot: row.slot, revision: row.revision, file_name: row.file_name, created_at: row.created_at, reason: admin ? row.reason : "", url });
  }
  return NextResponse.json({ versions }, { headers });
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no autorizado.", 403);
  const ctx = await context();
  if (!ctx || ctx.profile.user_type !== "administrator") return fail("Solo un administrador puede adjuntar imágenes.", 403);
  let form: FormData;
  try { form = await readHomeImageForm(request); } catch (error) {
    return error instanceof HomeImageBodyTooLarge
      ? fail("La imagen debe pesar como máximo 5 MB.", 413)
      : fail("Adjunto no válido.", 400);
  }
  const slot = String(form.get("slot") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const revisionValue = String(form.get("expectedRevision") ?? "");
  const expectedRevision = parseHomeImageRevision(revisionValue);
  if (!isHomeImageSlot(slot) || expectedRevision === null || reason.length < 5 || reason.length > 500 || form.get("confirmed") !== "true") {
    return fail("Indica el motivo y confirma el cambio.", 400);
  }
  const restoreVersion = form.get("restoreVersion");
  const file = form.get("file");
  const before = await ctx.client.from("home_image_versions").select("id,revision")
    .eq("organization_id", ctx.profile.organization_id)
    .eq("workspace_mode", ctx.profile.workspace_mode ?? "production").eq("slot", slot)
    .order("revision", { ascending: false }).limit(1).maybeSingle();
  if (before.error) return fail("No fue posible verificar el estado del espacio. No se adjuntó ningún archivo.", 503);
  if ((before.data?.revision ?? 0) !== expectedRevision) return fail("Otra persona modificó este espacio. Recarga antes de guardar.", 409);
  let path: string | null = null;
  let fileName: string | null = null;
  if (restoreVersion) {
    if (file || typeof restoreVersion !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restoreVersion)) return fail("Versión no válida.", 400);
  } else {
    if (!(file instanceof File) || !file.size || file.size > maximumHomeImageBytes) return fail("Adjunta una imagen PNG, JPG o WebP de hasta 5 MB.", 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = homeImageMime(bytes);
    if (!mime) return fail("El archivo debe ser una imagen PNG, JPG o WebP.", 400);
    const extension = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
    path = ctx.profile.organization_id + "/" + (ctx.profile.workspace_mode ?? "production") + "/" + ctx.profile.id + "/" + randomUUID() + "." + extension;
    fileName = file.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "imagen." + extension;
    const upload = await createAdminClient().storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false });
    if (upload.error) return fail("No fue posible adjuntar la imagen. No se cambió la imagen publicada.", 503);
  }
  const result = await ctx.client.rpc("publish_home_image", {
    requested_slot: slot, expected_revision: expectedRevision, requested_reason: reason,
    confirmed: true, new_object_path: path, new_file_name: fileName, restore_version: restoreVersion || null,
  });
  if (result.error) {
    // Keep unreferenced new objects on an ambiguous RPC response; never delete history.
    if (result.error.code === "40001") return fail("Otra persona modificó este espacio. Recarga antes de guardar.", 409);
    return fail("No se pudo verificar el guardado. Recarga antes de volver a intentarlo.", 503);
  }
  return NextResponse.json({ version: { id: result.data.id, revision: result.data.revision, slot: result.data.slot } }, { headers });
}
