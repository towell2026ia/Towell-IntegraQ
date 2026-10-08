import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { canPerformModuleAction } from "@/lib/module-permissions";
import type { SupplierAssessment, SupplierAssessmentType } from "@/lib/supplier-assessment-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";

const resourceType = "supplier_assessment_source";
const privateBucket = "integraq-private";
const allowedTypes = new Set<SupplierAssessmentType>(["supplier_audit", "semiannual_evaluation", "annual_evaluation", "quality_evaluation", "other"]);
const extensionMime: Record<string, string> = { csv: "text/csv", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

type AssessmentRow = { id: string; supplier_id: string; site_id: string | null; assessment_type: SupplierAssessmentType; assessment_date: string; evaluator_name: string | null; score: number | null; classification: string | null; observations: string | null; source_file_id: string | null; portal_visible: boolean; created_at: string };
type CompanyRow = { id: string; code: string; name: string; kind: string; active: boolean };
type SiteRow = { id: string; company_id: string; name: string; active: boolean };
type FileRow = { id: string; original_name: string; mime_type: string | null; size_bytes: number | null };

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const internalAccess = canPerformModuleAction(session, "suppliers", "view");
  const supplierAccess = session.userType === "Proveedor" && session.externalParty?.kind === "supplier";
  if (!internalAccess && !supplierAccess) return NextResponse.json({ error: "No tienes permiso para consultar evaluaciones de proveedores." }, { status: 403 });
  const admin = createAdminClient();
  let builder = admin.from("supplier_assessments").select("id,supplier_id,site_id,assessment_type,assessment_date,evaluator_name,score,classification,observations,source_file_id,portal_visible,created_at").order("assessment_date", { ascending: false }).order("created_at", { ascending: false });
  if (supplierAccess) {
    builder = builder.eq("supplier_id", session.externalParty!.companyId).eq("portal_visible", true);
    if (session.externalParty?.siteId) builder = builder.or(`site_id.is.null,site_id.eq.${session.externalParty.siteId}`);
  }
  const result = await builder;
  if (result.error) return NextResponse.json({ error: "No fue posible consultar las evaluaciones." }, { status: 500 });
  const rows = (result.data ?? []) as AssessmentRow[];
  const supplierIds = [...new Set(rows.map((row) => row.supplier_id))];
  const siteIds = [...new Set(rows.flatMap((row) => row.site_id ? [row.site_id] : []))];
  const fileIds = [...new Set(rows.flatMap((row) => row.source_file_id ? [row.source_file_id] : []))];
  const [companiesResult, sitesResult, filesResult] = await Promise.all([
    supplierIds.length ? admin.from("organizations").select("id,code,name,kind,active").in("id", supplierIds) : Promise.resolve({ data: [], error: null }),
    siteIds.length ? admin.from("external_company_sites").select("id,company_id,name,active").in("id", siteIds) : Promise.resolve({ data: [], error: null }),
    fileIds.length ? admin.from("file_objects").select("id,original_name,mime_type,size_bytes").in("id", fileIds).is("deleted_at", null) : Promise.resolve({ data: [], error: null }),
  ]);
  if (companiesResult.error || sitesResult.error || filesResult.error) return NextResponse.json({ error: "No fue posible completar el histórico de evaluaciones." }, { status: 500 });
  const companies = new Map(((companiesResult.data ?? []) as CompanyRow[]).map((row) => [row.id, row]));
  const sites = new Map(((sitesResult.data ?? []) as SiteRow[]).map((row) => [row.id, row]));
  const files = new Map(((filesResult.data ?? []) as FileRow[]).map((row) => [row.id, row]));
  return NextResponse.json({ assessments: rows.map((row) => mapAssessment(row, companies, sites, files)) });
}

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  if (!canPerformModuleAction(session, "suppliers", "update")) return NextResponse.json({ error: "No tienes permiso para registrar evaluaciones." }, { status: 403 });
  if (!session.authUserId) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Solicitud de evaluación no válida." }, { status: 400 });
  const supplierId = String(form.get("supplierId") ?? "");
  const siteId = String(form.get("siteId") ?? "") || null;
  const assessmentType = String(form.get("assessmentType") ?? "") as SupplierAssessmentType;
  const assessmentDate = String(form.get("assessmentDate") ?? "");
  const scoreText = String(form.get("score") ?? "").trim();
  const score = scoreText ? Number(scoreText) : null;
  const portalVisible = String(form.get("portalVisible")) === "true";
  const file = form.get("file");
  if (!supplierId || !/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate) || !allowedTypes.has(assessmentType)) return NextResponse.json({ error: "Completa proveedor, tipo y fecha." }, { status: 400 });
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) return NextResponse.json({ error: "La puntuación debe estar entre 0 y 100." }, { status: 400 });
  if (file !== null && (!(file instanceof File) || !file.size)) return NextResponse.json({ error: "Selecciona un archivo válido." }, { status: 400 });
  const admin = createAdminClient();
  const [companyResult, siteResult] = await Promise.all([
    admin.from("organizations").select("id,code,name,kind,active").eq("id", supplierId).eq("kind", "supplier").eq("active", true).maybeSingle(),
    siteId ? admin.from("external_company_sites").select("id,company_id,name,active").eq("id", siteId).eq("company_id", supplierId).eq("active", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (companyResult.error || !companyResult.data) return NextResponse.json({ error: "Selecciona un proveedor activo." }, { status: 400 });
  if (siteId && (siteResult.error || !siteResult.data)) return NextResponse.json({ error: "La sucursal no pertenece al proveedor seleccionado." }, { status: 400 });

  const assessmentId = crypto.randomUUID();
  let sourceFileId: string | null = null;
  let objectPath = "";
  if (file instanceof File) {
    const policy = await admin.from("file_upload_policies").select("max_size_bytes,allowed_mime_types").eq("resource_type", resourceType).maybeSingle();
    if (policy.error || !policy.data) return NextResponse.json({ error: "La política de carga no está disponible." }, { status: 503 });
    const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
    const mimeType = extensionMime[extension];
    if (!mimeType || !policy.data.allowed_mime_types.includes(mimeType)) return NextResponse.json({ error: "Formato no permitido. Usa XLSX, XLS o CSV." }, { status: 400 });
    if (file.size > policy.data.max_size_bytes) return NextResponse.json({ error: `El archivo supera el máximo de ${formatMegabytes(policy.data.max_size_bytes)} MB.` }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    sourceFileId = crypto.randomUUID();
    objectPath = `${session.authUserId}/supplier-assessments/${assessmentId}/${sourceFileId}/${safeName(file.name)}`;
    const uploaded = await admin.storage.from(privateBucket).upload(objectPath, bytes, { contentType: mimeType, cacheControl: "3600", upsert: false });
    if (uploaded.error) return NextResponse.json({ error: "No fue posible cargar el archivo de evaluación." }, { status: 500 });
    const insertedFile = await admin.from("file_objects").insert({ id: sourceFileId, bucket_id: privateBucket, object_path: objectPath, original_name: file.name, mime_type: mimeType, size_bytes: file.size, sha256: createHash("sha256").update(bytes).digest("hex"), module_id: "suppliers", external_organization_id: supplierId, external_site_id: siteId, audience: portalVisible ? "supplier" : "internal", resource_type: resourceType, resource_id: assessmentId, resource_key: companyResult.data.code, category: `supplier-assessment:${sourceFileId}`, uploaded_by: session.authUserId, preview_status: "pending" }).select("id").single();
    if (insertedFile.error) { await admin.storage.from(privateBucket).remove([objectPath]); return NextResponse.json({ error: "No fue posible registrar el archivo de evaluación." }, { status: 500 }); }
  }

  const inserted = await admin.from("supplier_assessments").insert({ id: assessmentId, supplier_id: supplierId, site_id: siteId, assessment_type: assessmentType, assessment_date: assessmentDate, evaluator_name: text(form, "evaluatorName"), score, classification: text(form, "classification"), observations: text(form, "observations"), source_file_id: sourceFileId, portal_visible: portalVisible, created_by: session.authUserId, updated_by: session.authUserId }).select("id,supplier_id,site_id,assessment_type,assessment_date,evaluator_name,score,classification,observations,source_file_id,portal_visible,created_at").single();
  if (inserted.error || !inserted.data) {
    if (sourceFileId) await admin.from("file_objects").delete().eq("id", sourceFileId);
    if (objectPath) await admin.storage.from(privateBucket).remove([objectPath]);
    return NextResponse.json({ error: "No fue posible registrar la evaluación." }, { status: 500 });
  }
  const sourceFile = sourceFileId && file instanceof File ? new Map([[sourceFileId, { id: sourceFileId, original_name: file.name, mime_type: extensionMime[file.name.split(".").pop()?.toLocaleLowerCase("en-US") ?? ""], size_bytes: file.size }]]) : new Map<string, FileRow>();
  return NextResponse.json({ assessment: mapAssessment(inserted.data as AssessmentRow, new Map([[companyResult.data.id, companyResult.data as CompanyRow]]), new Map(siteResult.data ? [[siteResult.data.id, siteResult.data as SiteRow]] : []), sourceFile) }, { status: 201 });
}

function mapAssessment(row: AssessmentRow, companies: Map<string, CompanyRow>, sites: Map<string, SiteRow>, files: Map<string, FileRow>): SupplierAssessment {
  const company = companies.get(row.supplier_id); const site = row.site_id ? sites.get(row.site_id) : undefined; const file = row.source_file_id ? files.get(row.source_file_id) : undefined;
  return { id: row.id, supplierId: row.supplier_id, supplierCode: company?.code ?? "", supplierName: company?.name ?? "Proveedor", siteId: row.site_id ?? undefined, siteName: site?.name, assessmentType: row.assessment_type, assessmentDate: row.assessment_date, evaluatorName: row.evaluator_name ?? undefined, score: row.score ?? undefined, classification: row.classification ?? undefined, observations: row.observations ?? undefined, portalVisible: row.portal_visible, sourceFile: file ? { id: file.id, name: file.original_name, mimeType: file.mime_type ?? "application/octet-stream", sizeBytes: file.size_bytes ?? 0 } : undefined, createdAt: row.created_at };
}
function text(form: FormData, key: string) { const value = String(form.get(key) ?? "").trim(); return value || null; }
function safeName(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-140); }
function formatMegabytes(bytes: number) { return Math.round((bytes / 1024 / 1024) * 10) / 10; }
