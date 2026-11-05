import { NextResponse } from "next/server";

import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerPortalDate, resolveCustomerPortalActor } from "@/lib/customer-portal-server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const session = await getAuthenticatedSession();
  const actor = await resolveCustomerPortalActor(session);
  if (!actor) return NextResponse.json({ error: "Acceso al Portal de Clientes no autorizado." }, { status: 403 });
  const { documentId } = await params;
  if (!uuid.test(documentId)) return NextResponse.json({ error: "Documento no disponible." }, { status: 404 });

  const admin = createAdminClient();
  const result = await admin.from("file_objects")
    .select("id,bucket_id,object_path,original_name,reference_type,validity_status,valid_from,valid_until,is_current,deleted_at,resource_type,workspace_id")
    .eq("id", documentId).eq("workspace_id", actor.workspaceId)
    .eq("resource_type", "general_information_document").eq("is_current", true).is("deleted_at", null).maybeSingle();
  const document = result.data;
  const today = customerPortalDate();
  const customerCanRead = actor.kind === "customer" && document?.reference_type === "external" &&
    document.validity_status === "current" && (!document.valid_from || document.valid_from <= today) &&
    (!document.valid_until || document.valid_until >= today);
  if (result.error || !document || (actor.kind === "customer" && !customerCanRead)) {
    return NextResponse.json({ error: "Documento no disponible." }, { status: 404 });
  }
  const download = new URL(request.url).searchParams.get("disposition") === "download";
  const signed = await admin.storage.from(document.bucket_id || "integraq-private").createSignedUrl(
    document.object_path, 60, download ? { download: document.original_name } : { download: false },
  );
  if (signed.error) return NextResponse.json({ error: "No fue posible abrir el archivo autorizado." }, { status: 500 });
  return NextResponse.redirect(signed.data.signedUrl, 302);
}
