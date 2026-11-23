import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { canAccessProcess, isAdministrator } from "@/lib/session-data";
import { buildRootCauseOfficialPdf } from "@/lib/root2cause/official-pdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bucket = "integraq-private";
const headers = { "Cache-Control": "private, no-store" };
const evidenceLimitBytes = 18 * 1024 * 1024;
type ActionRecord = {
  id: string; folio: string; title: string; problem: string; source: string; severity: string; area: string | null;
  process_id: string | null; owner_name: string | null; due_date: string | null; created_at: string; updated_at: string;
  external_reference: string | null; external_organization_id: string | null; corrective_action_a3: Record<string, unknown> | Record<string, unknown>[] | null;
  corrective_action_plans?: Record<string, unknown>[];
};
type AuthorizedAction = { session: NonNullable<Awaited<ReturnType<typeof getAuthenticatedSession>>>; admin: ReturnType<typeof createAdminClient>; action: ActionRecord; organizationId: string } | { error: NextResponse };

async function authorized(actionId: string): Promise<AuthorizedAction> {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId || session.workspaceMode === "demo" || !["Administrador", "Usuario interno"].includes(session.userType) || !canPerformModuleAction(session, "corrective-actions", "view")) {
    return { error: NextResponse.json({ error: "No tienes permiso para consultar este análisis." }, { status: 403, headers }) };
  }
  const admin = createAdminClient();
  const profile = await admin.from("profiles").select("organization_id,user_type,status,workspace_mode").eq("id", session.authUserId).maybeSingle();
  const role = isAdministrator(session) ? "administrator" : "internal";
  if (profile.error || profile.data?.status !== "active" || profile.data.user_type !== role || profile.data.workspace_mode === "demo" || !profile.data.organization_id) {
    return { error: NextResponse.json({ error: "El perfil interno no está activo." }, { status: 403, headers }) };
  }
  const result = await admin.from("corrective_actions").select("id,organization_id,folio,title,problem,source,severity,area,process_id,owner_name,due_date,created_at,updated_at,external_reference,external_organization_id,quality_case_id,deleted_at,corrective_action_a3(event_type,severity_justification,five_w_two_h,brainstorm,ishikawa,non_detection_cause,non_detection_whys,root_cause,root_cause_whys,workflow_metadata),corrective_action_plans(id,description,owner_name,due_date,status,cause_text,expected_result,completion_evidence,effectiveness_method)")
    .eq("id", actionId).eq("organization_id", profile.data.organization_id).is("deleted_at", null).maybeSingle();
  if (result.error || !result.data) return { error: NextResponse.json({ error: "El análisis no está disponible." }, { status: 404, headers }) };
  if (result.data.process_id && !canAccessProcess(session, result.data.process_id)) return { error: NextResponse.json({ error: "No tienes acceso al proceso de este análisis." }, { status: 403, headers }) };
  return { session, admin, action: result.data as unknown as ActionRecord, organizationId: String(profile.data.organization_id) };
}

export async function GET(request: Request, context: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await context.params;
  if (!uuid.test(actionId)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400, headers });
  const scope = await authorized(actionId);
  if ("error" in scope) return scope.error;
  const fileId = new URL(request.url).searchParams.get("fileId");
  let query = scope.admin.from("file_objects").select("id,bucket_id,object_path,original_name,version,sha256,size_bytes,is_current,created_at")
    .eq("workspace_id", scope.organizationId).eq("resource_type", "root2cause_official_pdf").eq("resource_id", actionId).is("deleted_at", null);
  if (fileId) query = query.eq("id", fileId);
  else query = query.order("version", { ascending: false }).limit(50);
  const record = await query;
  if (record.error) return NextResponse.json({ error: "No fue posible consultar las versiones PDF." }, { status: 503, headers });
  const rows = Array.isArray(record.data) ? record.data : record.data ? [record.data] : [];
  if (!fileId) return NextResponse.json({ files: rows.filter(row => row.bucket_id === bucket).map(row => ({ id: row.id, version: row.version, sha256: row.sha256, sizeBytes: row.size_bytes, createdAt: row.created_at, current: row.is_current })) }, { headers });
  const file = rows[0];
  if (!file || file.bucket_id !== bucket) return NextResponse.json({ error: "La versión PDF no está disponible." }, { status: 404, headers });
  const bytes = await scope.admin.storage.from(bucket).download(file.object_path);
  if (bytes.error || !bytes.data || createHash("sha256").update(Buffer.from(await bytes.data.arrayBuffer())).digest("hex") !== String(file.sha256).toLowerCase()) {
    return NextResponse.json({ error: "La integridad del PDF no pudo confirmarse." }, { status: 503, headers });
  }
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const signed = await scope.admin.storage.from(bucket).createSignedUrl(file.object_path, 60, preview ? undefined : { download: file.original_name });
  if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: "No fue posible preparar la descarga autorizada." }, { status: 503, headers });
  if (preview) return new NextResponse(null,{status:302,headers:{...headers,Location:signed.data.signedUrl,"Referrer-Policy":"no-referrer"}});
  return NextResponse.json({ fileId: file.id, version: file.version, sha256: file.sha256, signedUrl: signed.data.signedUrl }, { headers });
}

export async function POST(_request: Request, context: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await context.params;
  if (!uuid.test(actionId)) return NextResponse.json({ error: "Identificador inválido." }, { status: 400, headers });
  const scope = await authorized(actionId);
  if ("error" in scope) return scope.error;
  const { action, admin, organizationId, session } = scope;
  const [customerResult, processResult] = await Promise.all([
    action.external_organization_id ? admin.from("organizations").select("id,name,kind,owning_organization_id").eq("id", action.external_organization_id).eq("kind", "customer").eq("owning_organization_id", organizationId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    action.process_id ? admin.from("processes").select("id,name,organization_id").eq("id", action.process_id).eq("organization_id", organizationId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (customerResult.error || processResult.error || (action.external_organization_id && !customerResult.data) || (action.process_id && !processResult.data)) return NextResponse.json({ error: "No se pudo confirmar la identidad del cliente o proceso para el PDF." }, { status: 503, headers });
  const userDb = await createClient();
  const analysisRow = Array.isArray(action.corrective_action_a3) ? action.corrective_action_a3[0] : action.corrective_action_a3;
  const plans = (action.corrective_action_plans ?? []) as Record<string, unknown>[];
  const workflow = (analysisRow?.workflow_metadata ?? {}) as Record<string, unknown>;
  const evidenceId = typeof workflow.evidenceId === "string" ? workflow.evidenceId : action.id;
  if (!uuid.test(evidenceId)) return NextResponse.json({ error: "El análisis no tiene una referencia de evidencias válida." }, { status: 409, headers });
  const keys = Array.from(new Set([`${evidenceId}_step_0`, `${evidenceId}_step_1`, `${evidenceId}_step_2`, `${evidenceId}_step_3`, `${evidenceId}_step_4`, `${evidenceId}_step_5`, `${evidenceId}_step_6`, `${evidenceId}_step_7`, ...plans.map(plan => `${evidenceId}_plan_${String(plan.id)}`)]));
  const filesResult = action.process_id
    ? await admin.from("file_objects").select("id,bucket_id,object_path,original_name,mime_type,size_bytes,sha256,workspace_id,process_id,module_id,audience,resource_type,resource_key,deleted_at")
      .eq("workspace_id", organizationId).eq("process_id", action.process_id).eq("module_id", "corrective-actions").eq("audience", "internal")
      .eq("resource_type", "root2cause_evidence").in("resource_key", keys).eq("is_current", true).is("deleted_at", null).order("created_at", { ascending: true }).limit(101)
    : { data: [], error: null };
  if (filesResult.error) return NextResponse.json({ error: "No fue posible consultar las evidencias autorizadas." }, { status: 503, headers });
  if ((filesResult.data?.length ?? 0) > 100) return NextResponse.json({ error: "El expediente supera las 100 evidencias por PDF. No se registró una versión parcial." }, { status: 422, headers });
  if (!analysisRow) return NextResponse.json({ error: "Falta el análisis persistido del expediente." }, {status:409,headers});
  const evidence: Array<{ name: string; mime: string; sha256: string; imagePng?: Uint8Array }> = [];
  let bytesRead = 0;
  for (const file of filesResult.data ?? []) {
    const key = String(file.resource_key ?? "");
    if (file.bucket_id !== bucket || !keys.includes(key) || !file.object_path.includes(`/attachments/corrective-actions/root2cause_evidence/${key}/`) || file.process_id !== action.process_id || file.workspace_id !== organizationId || !/^[a-f0-9]{64}$/i.test(String(file.sha256 ?? ""))) {
      return NextResponse.json({ error: "Una evidencia no cumple el alcance o la integridad del expediente." }, { status: 403, headers });
    }
    const access = await userDb.rpc("iq_root2cause_evidence_access", { p_key: key, p_process: action.process_id, p_write: false, p_uploader: session.authUserId });
    if (access.error || access.data !== true) return NextResponse.json({ error: "No se pudo verificar el permiso de una evidencia. No se generó el PDF." }, { status: 503, headers });
    const download = await admin.storage.from(bucket).download(file.object_path);
    if (download.error || !download.data) return NextResponse.json({ error: "No se pudo leer una evidencia privada autorizada." }, { status: 503, headers });
    const raw = Buffer.from(await download.data.arrayBuffer());
    bytesRead += raw.byteLength;
    const sha256 = createHash("sha256").update(raw).digest("hex");
    if (bytesRead > evidenceLimitBytes || sha256 !== String(file.sha256).toLowerCase()) return NextResponse.json({ error: "La evidencia excede el límite o su SHA-256 no coincide." }, { status: 422, headers });
    const entry: { name: string; mime: string; sha256: string; imagePng?: Uint8Array } = { name: String(file.original_name), mime: String(file.mime_type), sha256 };
    if (String(file.mime_type).startsWith("image/")) {
      try { entry.imagePng = new Uint8Array(await sharp(raw).rotate().png().toBuffer()); }
      catch { return NextResponse.json({ error: "Una fotografía no pudo procesarse para el PDF; el original permanece intacto." }, { status: 422, headers }); }
    }
    evidence.push(entry);
  }
  const a3 = {
    severityJustification: analysisRow?.severity_justification, fiveW2H: analysisRow?.five_w_two_h,
    brainstorm: analysisRow?.brainstorm, ishikawa: analysisRow?.ishikawa,
    nonDetectionCause: analysisRow?.non_detection_cause, rootCause: analysisRow?.root_cause,
    nonDetectionWhys: analysisRow?.non_detection_whys, rootCauseWhys: analysisRow?.root_cause_whys,
  } as Record<string, unknown>;
  const pdf = buildRootCauseOfficialPdf({ folio: String(action.folio), title: String(workflow.descriptiveTitle ?? action.title), problem: String(action.problem), source: String(action.source),
    severity: String(action.severity), area: String(action.area ?? ""), process: String(processResult.data?.name ?? ""), owner: String(action.owner_name ?? ""), reportDate: String(action.created_at ?? ""),
    dueDate: String(action.due_date ?? ""), customer: String(customerResult.data?.name ?? ""), externalReference: String(action.external_reference ?? ""),
    analysis: { ...a3, ...(workflow as Record<string, unknown>), eventType: analysisRow?.event_type }, plans, evidence });
  if (!pdf.byteLength || pdf.byteLength > 20 * 1024 * 1024) return NextResponse.json({ error: "El PDF oficial supera el límite permitido." }, { status: 422, headers });
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const path = `root2cause-official-pdf/${organizationId}/${actionId}/${sha256}.pdf`;
  const existing = await admin.from("file_objects").select("id,version,sha256,size_bytes,object_path,bucket_id")
    .eq("workspace_id", organizationId).eq("resource_type", "root2cause_official_pdf").eq("resource_id", actionId).eq("object_path", path).maybeSingle();
  if (existing.error) return NextResponse.json({ error: "No fue posible comprobar una versión PDF anterior." }, { status: 503, headers });
  let fileId = String(existing.data?.id ?? randomUUID());
  if (existing.data && (existing.data.sha256 !== sha256 || existing.data.bucket_id !== bucket || existing.data.size_bytes !== pdf.byteLength)) return NextResponse.json({ error: "La versión PDF existente no coincide con su huella; no se sobrescribió." }, { status: 409, headers });
  if (!existing.data) {
    const uploaded = await admin.storage.from(bucket).upload(path, pdf, { contentType: "application/pdf", upsert: false, cacheControl: "3600" });
    if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message ?? "")) return NextResponse.json({ error: "No se pudo almacenar el PDF privado." }, { status: 503, headers });
  }
  const registered = await admin.rpc("iq_root2cause_register_official_pdf", { p_actor_id: session.authUserId, p_action_id: actionId, p_file: { id: fileId, bucket, path, mime: "application/pdf", sizeBytes: pdf.byteLength, sha256, sourceUpdatedAt: action.updated_at } });
  if (registered.error || !registered.data || typeof registered.data.fileId !== "string") {
    const confirmed = await admin.from("file_objects").select("id,version,sha256,size_bytes").eq("workspace_id", organizationId).eq("resource_type", "root2cause_official_pdf").eq("resource_id", actionId).eq("object_path", path).maybeSingle();
    if (!confirmed.data) return NextResponse.json({ error: "El PDF se creó, pero su registro/versionado requiere instalar el contrato SQL Root2Cause. No se emitió un enlace." }, { status: 503, headers });
    fileId = String(confirmed.data.id);
  } else fileId = registered.data.fileId;
  const metadata = await admin.from("file_objects").select("id,object_path,original_name,version,sha256").eq("id", fileId).eq("workspace_id", organizationId).eq("resource_type", "root2cause_official_pdf").eq("resource_id", actionId).eq("bucket_id", bucket).is("deleted_at", null).maybeSingle();
  if (metadata.error || !metadata.data) return NextResponse.json({ error: "La versión quedó almacenada, pero no se pudo validar su referencia." }, { status: 503, headers });
  const signed = await admin.storage.from(bucket).createSignedUrl(metadata.data.object_path, 60, { download: metadata.data.original_name });
  if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: "El PDF quedó almacenado, pero no se pudo preparar la descarga autorizada." }, { status: 503, headers });
  return NextResponse.json({ fileId: metadata.data.id, version: metadata.data.version, sha256: metadata.data.sha256, signedUrl: signed.data.signedUrl }, { headers });
}
