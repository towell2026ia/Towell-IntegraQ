import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const { fileId } = await params;
  const supabase = await createClient();
  const record = await supabase.from("file_objects").select("bucket_id,object_path").eq("id", fileId).eq("resource_type", "supplier_rncp_action_evidence").is("deleted_at", null).maybeSingle();
  if (record.error || !record.data) return NextResponse.json({ error: "La evidencia no está disponible para esta cuenta." }, { status: 404 });
  const signed = await createAdminClient().storage.from(record.data.bucket_id || "integraq-private").createSignedUrl(record.data.object_path, 120);
  if (signed.error || !signed.data) return NextResponse.json({ error: "No fue posible abrir la evidencia." }, { status: 500 });
  return NextResponse.json({ signedUrl: signed.data.signedUrl, expiresIn: 120 });
}
