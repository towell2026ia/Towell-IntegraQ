import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { validRncpFileSignature } from "@/lib/rncp/file-signature";

const resourceType = "supplier_rncp_action_evidence";
const privateBucket = "integraq-private";
const extensionMime: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const staff = session.userType !== "Proveedor";
  if (staff && session.specificPermissions?.["rncp.revisar_evidencias"] !== true) return NextResponse.json({ error: "Tu cuenta requiere permiso para adjuntar evidencias." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const actionId = form?.get("actionId");
  const file = form?.get("file");
  if (typeof actionId !== "string" || !(file instanceof File) || !file.size) return NextResponse.json({ error: "Selecciona un archivo válido." }, { status: 400 });

  const supabase = await createClient();
  const [actionResult, policyResult] = await Promise.all([
    supabase.from("supplier_rncp_actions").select("id,report_id,created_by,status,executed_at").eq("id", actionId).maybeSingle(),
    supabase.from("file_upload_policies").select("max_size_bytes,allowed_mime_types").eq("resource_type", resourceType).maybeSingle(),
  ]);
  if (actionResult.error || !actionResult.data || actionResult.data.created_by !== session.authUserId) return NextResponse.json({ error: "No tienes acceso para adjuntar archivos a esta acción." }, { status: 403 });
  if (!["pending", "in_progress", "rejected"].includes(actionResult.data.status)) return NextResponse.json({ error: "La entrega está en validación o ya fue validada. Sus evidencias se conservan sin modificaciones." }, { status: 409 });
  if (policyResult.error || !policyResult.data) return NextResponse.json({ error: "La política de carga no está disponible." }, { status: 503 });
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
  const mimeType = extensionMime[extension] ?? file.type;
  if (!policyResult.data.allowed_mime_types.includes(mimeType)) return NextResponse.json({ error: "Formato no permitido. Usa JPG, JPEG, PNG, WEBP, PDF, XLS o XLSX." }, { status: 400 });
  const maxSizeBytes = Math.min(policyResult.data.max_size_bytes, 4 * 1024 * 1024);
  if (file.size > maxSizeBytes) return NextResponse.json({ error: `El archivo supera el máximo de ${formatMegabytes(maxSizeBytes)} MB.` }, { status: 400 });

  const reportResult = await supabase.from("supplier_rncp_reports").select("*").eq("id", actionResult.data.report_id).maybeSingle();
  if (reportResult.error || !reportResult.data || reportResult.data.deleted_at || !["submitted", "in_progress"].includes(reportResult.data.status)) {
    return NextResponse.json({ error: "La RNCP no admite nuevas evidencias." }, { status: 400 });
  }
  const userId = session.authUserId;
  if (!userId) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const performedOn=String(form?.get("performedOn")??actionResult.data.executed_at??"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(performedOn)||performedOn>new Date().toISOString().slice(0,10))return NextResponse.json({error:"Indica la fecha real de cumplimiento."},{status:400});
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validRncpFileSignature(bytes, mimeType)) return NextResponse.json({ error: "El contenido del archivo no corresponde a un formato admitido." }, { status: 400 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const scope=staff ? await supabase.rpc("iq_rncp_faculty",{p_organization_id:reportResult.data.organization_id,p_action:"revisar_evidencias"}) : await supabase.rpc("iq_supplier_portal_prepare_upload",{p_event:null,p_action:actionId,p_date:performedOn,p_sha:sha256,p_mime:mimeType,p_bytes:file.size});
  if(scope.error || staff && scope.data !== true)return NextResponse.json({error:"Expediente no autorizado."},{status:403});
  const admin=createAdminClient();
  const known=await supabase.from("file_objects").select("id").eq("resource_type",resourceType).eq("resource_id",actionId).eq("uploaded_by",userId).eq("sha256",sha256).is("deleted_at",null).limit(1);
  if(known.error)return NextResponse.json({error:"No se pudo comprobar la evidencia existente."},{status:503});
  const path=["supplier-rncp-responses",userId,actionId,sha256].join("/");
  if(!known.data?.length){
    const stored=await admin.storage.from(privateBucket).upload(path,bytes,{upsert:false,contentType:mimeType});
    if(stored.error&&String(stored.error.statusCode)!=="409"&&!/already exists/i.test(stored.error.message))return NextResponse.json({error:"No se pudo cargar la evidencia."},{status:503});
  }
  const registered=await supabase.rpc(staff ? "iq_rncp_staff_evidence" : "iq_supplier_portal_rncp_evidence",{p_action:actionId,p_date:performedOn,p_sha:sha256,p_name:file.name,p_mime:mimeType,p_bytes:file.size});
  if(registered.error)return NextResponse.json({error:"No se confirmó el vínculo de la evidencia. Comprueba el expediente y reintenta con el mismo archivo."},{status:registered.error.code==="42501"?403:409});
  const row=await supabase.from("file_objects").select("id,original_name,mime_type,size_bytes,uploaded_by,created_at").eq("id",registered.data).single();
  if(row.error||!row.data)return NextResponse.json({error:"No se pudo recuperar la evidencia registrada."},{status:503});
  const f=row.data;return NextResponse.json({evidence:{id:f.id,fileName:f.original_name,mimeType:f.mime_type,sizeBytes:f.size_bytes,uploadedBy:f.uploaded_by,uploadedAt:f.created_at}},{status:201});
}
function formatMegabytes(bytes: number) { return Math.round((bytes / 1024 / 1024) * 10) / 10; }
