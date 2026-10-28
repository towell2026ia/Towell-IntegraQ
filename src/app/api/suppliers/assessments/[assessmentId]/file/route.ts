import { canUseSupplierApi, canReadSupplierRecord } from "@/lib/portal-security";
import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ assessmentId: string }> }) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  if (!canUseSupplierApi(session)) return NextResponse.json({ error: "Acceso a proveedores no autorizado." }, { status: 403 });
  const { assessmentId } = await params;
  const supabase = await createClient();
  const assessment = await supabase.from("supplier_assessments").select("source_file_id,supplier_id,site_id,portal_visible").eq("id", assessmentId).maybeSingle();
  if (assessment.error || !assessment.data?.source_file_id || !canReadSupplierRecord(session, assessment.data.supplier_id, assessment.data.site_id) || (session.userType === "Proveedor" && !assessment.data.portal_visible)) return NextResponse.json({ error: "El archivo no está disponible para esta cuenta." }, { status: 404 });
  const file = await supabase.from("file_objects").select("bucket_id,object_path,original_name").eq("id", assessment.data.source_file_id).eq("resource_type", "supplier_assessment_source").is("deleted_at", null).maybeSingle();
  if (file.error || !file.data) return NextResponse.json({ error: "El archivo no está disponible para esta cuenta." }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "true";
  const signed = await createAdminClient().storage.from(file.data.bucket_id || "integraq-private").createSignedUrl(file.data.object_path, 120, download ? { download: file.data.original_name } : undefined);
  if (signed.error || !signed.data) return NextResponse.json({ error: "No fue posible abrir el archivo." }, { status: 500 });
  return NextResponse.json({ signedUrl: signed.data.signedUrl, expiresIn: 120 });
}
