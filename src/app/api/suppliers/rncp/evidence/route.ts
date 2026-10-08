import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const resourceType = "supplier_rncp_action_evidence";
const privateBucket = "integraq-private";
const extensionMime: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  if (session.userType !== "Proveedor") return NextResponse.json({ error: "Sólo el proveedor puede adjuntar evidencias desde este portal." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const actionId = form?.get("actionId");
  const file = form?.get("file");
  if (typeof actionId !== "string" || !(file instanceof File) || !file.size) return NextResponse.json({ error: "Selecciona un archivo válido." }, { status: 400 });

  const supabase = await createClient();
  const [actionResult, policyResult] = await Promise.all([
    supabase.from("supplier_rncp_actions").select("id,report_id,created_by,status").eq("id", actionId).maybeSingle(),
    supabase.from("file_upload_policies").select("max_size_bytes,allowed_mime_types").eq("resource_type", resourceType).maybeSingle(),
  ]);
  if (actionResult.error || !actionResult.data || actionResult.data.created_by !== session.authUserId) return NextResponse.json({ error: "No tienes acceso para adjuntar archivos a esta acción." }, { status: 403 });
  if (policyResult.error || !policyResult.data) return NextResponse.json({ error: "La política de carga no está disponible." }, { status: 503 });
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
  const mimeType = extensionMime[extension] ?? file.type;
  if (!policyResult.data.allowed_mime_types.includes(mimeType)) return NextResponse.json({ error: "Formato no permitido. Usa JPG, JPEG, PNG, WEBP, PDF, XLS o XLSX." }, { status: 400 });
  if (file.size > policyResult.data.max_size_bytes) return NextResponse.json({ error: `El archivo supera el máximo de ${formatMegabytes(policyResult.data.max_size_bytes)} MB.` }, { status: 400 });

  const reportResult = await supabase.from("supplier_rncp_reports").select("id,folio,supplier_id,site_id,status,deleted_at").eq("id", actionResult.data.report_id).maybeSingle();
  if (reportResult.error || !reportResult.data || reportResult.data.deleted_at || !["submitted", "in_progress"].includes(reportResult.data.status)) {
    return NextResponse.json({ error: "La RNCP no admite nuevas evidencias." }, { status: 400 });
  }
  const userId = session.authUserId;
  if (!userId) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const fileId = crypto.randomUUID();
  const objectPath = `${userId}/rncp/${actionId}/${fileId}/${safeName(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const admin = createAdminClient();
  const uploaded = await admin.storage.from(privateBucket).upload(objectPath, bytes, { contentType: mimeType, cacheControl: "3600", upsert: false });
  if (uploaded.error) return NextResponse.json({ error: "No fue posible cargar la evidencia." }, { status: 500 });

  const inserted = await admin.from("file_objects").insert({
    id: fileId, bucket_id: privateBucket, object_path: objectPath, original_name: file.name,
    mime_type: mimeType, size_bytes: file.size, sha256: createHash("sha256").update(bytes).digest("hex"),
    module_id: "suppliers", external_organization_id: reportResult.data.supplier_id,
    external_site_id: reportResult.data.site_id, audience: "supplier", resource_type: resourceType,
    resource_id: actionId, resource_key: reportResult.data.folio, category: `rncp-evidence:${fileId}`,
    uploaded_by: userId, preview_status: mimeType.startsWith("image/") || mimeType === "application/pdf" ? "not_required" : "pending",
  }).select("id,original_name,mime_type,size_bytes,uploaded_by,created_at").single();
  if (inserted.error || !inserted.data) {
    await admin.storage.from(privateBucket).remove([objectPath]);
    return NextResponse.json({ error: "No fue posible registrar la evidencia." }, { status: 500 });
  }
  const linked = await admin.from("supplier_rncp_action_evidence").insert({ action_id: actionId, file_id: fileId, created_by: userId });
  if (linked.error) {
    await admin.from("file_objects").delete().eq("id", fileId);
    await admin.storage.from(privateBucket).remove([objectPath]);
    return NextResponse.json({ error: "No fue posible vincular la evidencia a la acción." }, { status: 500 });
  }
  return NextResponse.json({ evidence: { id: inserted.data.id, fileName: inserted.data.original_name, mimeType: inserted.data.mime_type, sizeBytes: inserted.data.size_bytes, uploadedBy: inserted.data.uploaded_by, uploadedAt: inserted.data.created_at } }, { status: 201 });
}

function safeName(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-140); }
function formatMegabytes(bytes: number) { return Math.round((bytes / 1024 / 1024) * 10) / 10; }
