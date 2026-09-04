import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ensureMetrologyWorkspace, isMetrologyWorkspace, prepareMetrologyWorkspace, type MetrologyActor } from "@/lib/metrology-workspace-server";
import type { MetrologyAttachment } from "@/lib/metrology-report-data";

export const maxDuration = 30;

async function requireActor(requireWrite = false): Promise<MetrologyActor | null> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const admin = createAdminClient();
  const profile = await admin.from("profiles").select("user_type,status").eq("id", userData.user.id).maybeSingle();
  if (profile.error || !profile.data || profile.data.status !== "active" || !["administrator", "internal"].includes(profile.data.user_type)) return null;
  const actor = { id: userData.user.id, userType: profile.data.user_type as MetrologyActor["userType"] };
  if (!requireWrite || actor.userType === "administrator") return actor;
  const [actions, modulePermission] = await Promise.all([
    admin.from("user_module_action_permissions").select("action").eq("user_id", actor.id).eq("module_id", "calibrations").in("action", ["create", "update", "manage"]).limit(1),
    admin.from("user_module_permissions").select("can_manage").eq("user_id", actor.id).eq("module_id", "calibrations").maybeSingle(),
  ]);
  if (actions.error || modulePermission.error) return null;
  return actions.data?.length || modulePermission.data?.can_manage ? actor : null;
}

export async function GET() {
  try {
    const actor = await requireActor();
    if (!actor) return NextResponse.json({ error: "Acceso interno requerido." }, { status: 403 });
    const record = await ensureMetrologyWorkspace(actor);
    return NextResponse.json({ workspace: record.values, updatedAt: record.updated_at, storage: "supabase" });
  } catch (error) {
    console.error("No fue posible cargar el expediente de metrología.", error);
    return NextResponse.json({ error: "No fue posible cargar el expediente de metrología." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireActor(true);
    if (!actor) return NextResponse.json({ error: "No tienes permiso para guardar verificaciones o calibraciones." }, { status: 403 });
    const payload = await request.json() as { workspace?: unknown };
    if (!isMetrologyWorkspace(payload.workspace)) return NextResponse.json({ error: "El expediente enviado no tiene una estructura válida." }, { status: 400 });
    if (payload.workspace.reports.some((report) => report.signatureDataUrl && report.signatureDataUrl.length > 250_000)) return NextResponse.json({ error: "La firma libre excede el tamaño permitido." }, { status: 413 });
    const record = await ensureMetrologyWorkspace(actor);
    const workspace = prepareMetrologyWorkspace(payload.workspace, isMetrologyWorkspace(record.values) ? record.values : undefined);
    const admin = createAdminClient();
    const updated = await admin.from("form_records").update({ values: workspace }).eq("id", record.id).select("updated_at").single();
    if (updated.error) throw updated.error;
    await admin.from("audit_log").insert({ actor_id: actor.id, action: "metrology.workspace_updated", resource_type: "metrology_workspace", resource_id: record.id, metadata: { asset_count: workspace.assets.length, report_count: workspace.reports.length } });
    return NextResponse.json({ workspace, updatedAt: updated.data.updated_at });
  } catch (error) {
    console.error("No fue posible guardar el expediente de metrología.", error);
    return NextResponse.json({ error: "No fue posible guardar el expediente de metrología." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const registeredIds: string[] = [];
  let uploadedPaths: string[] = [];
  try {
    const actor = await requireActor(true);
    if (!actor) return NextResponse.json({ error: "No tienes permiso para adjuntar certificados de calibración." }, { status: 403 });
    const payload = await request.json() as { assetId?: unknown; files?: unknown };
    if (typeof payload.assetId !== "string" || !Array.isArray(payload.files) || !payload.files.length || payload.files.length > 10) {
      return NextResponse.json({ error: "La solicitud de certificados no es válida." }, { status: 400 });
    }
    const record = await ensureMetrologyWorkspace(actor);
    if (!isMetrologyWorkspace(record.values)) return NextResponse.json({ error: "El expediente de metrología no está disponible." }, { status: 409 });
    const asset = record.values.assets.find((item) => item.id === payload.assetId && item.activity === "calibration");
    if (!asset) return NextResponse.json({ error: "El equipo no corresponde a una calibración externa." }, { status: 400 });

    const expectedPrefix = `${actor.id}/metrology/${safeObjectName(asset.code)}/`;
    const candidates = payload.files.map((value) => normalizeCertificateCandidate(value, expectedPrefix));
    if (candidates.some((value) => !value)) return NextResponse.json({ error: "Uno o más certificados no son válidos." }, { status: 400 });
    const files = candidates as CertificateCandidate[];
    uploadedPaths = files.map((file) => file.objectPath);
    const admin = createAdminClient();
    const attachments: MetrologyAttachment[] = [];
    for (const file of files) {
      const folder = file.objectPath.slice(0, file.objectPath.lastIndexOf("/"));
      const objectName = file.objectPath.slice(file.objectPath.lastIndexOf("/") + 1);
      const stored = await admin.storage.from("integraq-private").list(folder, { search: objectName, limit: 2 });
      if (stored.error || !stored.data.some((item) => item.name === objectName)) throw new Error("No fue posible validar uno de los certificados cargados.");
      const inserted = await admin.from("file_objects").insert({
        bucket_id: "integraq-private",
        object_path: file.objectPath,
        original_name: file.fileName,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
        sha256: file.sha256,
        module_id: "calibrations",
        audience: "internal",
        resource_type: "metrology_calibration_certificate",
        category: asset.code,
        uploaded_by: actor.id,
      }).select("id,created_at").single();
      if (inserted.error) throw inserted.error;
      registeredIds.push(inserted.data.id);
      attachments.push({ id: inserted.data.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, storageBucket: "integraq-private", storageObjectPath: file.objectPath, uploadedAt: inserted.data.created_at });
    }
    return NextResponse.json({ attachments });
  } catch (error) {
    console.error("No fue posible registrar los certificados de calibración.", error);
    const admin = createAdminClient();
    if (registeredIds.length) await admin.from("file_objects").delete().in("id", registeredIds);
    if (uploadedPaths.length) await admin.storage.from("integraq-private").remove(uploadedPaths);
    return NextResponse.json({ error: "No fue posible registrar los certificados de calibración." }, { status: 500 });
  }
}

interface CertificateCandidate {
  objectPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

function normalizeCertificateCandidate(value: unknown, expectedPrefix: string): CertificateCandidate | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CertificateCandidate>;
  const validMimeTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
  if (typeof candidate.objectPath !== "string" || !candidate.objectPath.startsWith(expectedPrefix)) return null;
  if (typeof candidate.fileName !== "string" || !candidate.fileName.trim() || candidate.fileName.length > 255) return null;
  if (typeof candidate.mimeType !== "string" || !validMimeTypes.has(candidate.mimeType)) return null;
  if (typeof candidate.sizeBytes !== "number" || !Number.isInteger(candidate.sizeBytes) || candidate.sizeBytes < 1 || candidate.sizeBytes > 20 * 1024 * 1024) return null;
  if (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.sha256)) return null;
  return candidate as CertificateCandidate;
}

function safeObjectName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-140);
}
