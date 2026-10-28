import { NextResponse } from "next/server";
import { canAccessCompanyRecord } from "@/lib/access-policy";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";
export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
  const kind = session.userType === "Cliente" ? "customer" : session.userType === "Proveedor" ? "supplier" : null;
  if (!kind || session.workspaceMode === "demo") return NextResponse.json({ error: "Portal no autorizado." }, { status: 403 });
  const db = await createClient(), { fileId } = await params;
  const file = await db.from("file_objects").select("bucket_id,object_path,external_organization_id,external_site_id,audience").eq("id", fileId).is("deleted_at", null).maybeSingle();
  if (file.error || !file.data || !canAccessCompanyRecord(session, kind, file.data.external_organization_id, file.data.external_site_id ?? undefined) || !["shared", kind].includes(file.data.audience)) return NextResponse.json({ error: "Archivo no disponible." }, { status: 404 });
  const signed = await db.storage.from(file.data.bucket_id).createSignedUrl(file.data.object_path, 120);
  if (signed.error) return NextResponse.json({ error: "Archivo no disponible." }, { status: 404 });
  return NextResponse.json({ signedUrl: signed.data.signedUrl }, { headers: { "Cache-Control": "private, no-store" } });
}
