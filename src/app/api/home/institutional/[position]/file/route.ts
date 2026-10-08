import { NextResponse } from "next/server";

import type { InstitutionalPosition } from "@/lib/institutional-information-data";
import { isAdministrator } from "@/lib/session-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";

const positions = new Set<InstitutionalPosition>(["POLICY_QUALITY", "CODE_ETHICS", "CONFIDENTIALITY"]);

export async function GET(_request: Request, { params }: { params: Promise<{ position: string }> }) {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const { position: rawPosition } = await params;
  const position = rawPosition as InstitutionalPosition;
  if (!positions.has(position)) return NextResponse.json({ error: "Referencia institucional no válida." }, { status: 404 });
  const admin = createAdminClient();
  const item = await admin.from("home_institutional_items").select("position,content_kind,document_id,visible_to_internal,visible_to_external,active").eq("position", position).maybeSingle();
  const visible = item.data?.active && item.data.content_kind === "document" && item.data.document_id && (isAdministrator(session) || (session.userType === "Usuario interno" ? item.data.visible_to_internal : item.data.visible_to_external));
  if (item.error || !visible) return NextResponse.json({ error: "El documento institucional no está disponible para esta cuenta." }, { status: 404 });
  const document = await admin.from("controlled_documents").select("id,active,deleted_at").eq("id", item.data!.document_id!).eq("active", true).is("deleted_at", null).maybeSingle();
  if (document.error || !document.data) return NextResponse.json({ error: "El documento institucional no está vigente." }, { status: 404 });
  const lifecycle = await admin.from("document_lifecycle").select("lifecycle_status,is_deleted").eq("document_id", document.data.id).maybeSingle();
  if (lifecycle.error || (lifecycle.data && (lifecycle.data.is_deleted || lifecycle.data.lifecycle_status !== "active"))) return NextResponse.json({ error: "El documento institucional no está vigente." }, { status: 404 });
  const version = await admin.from("controlled_document_versions").select("id,file_id,revision").eq("document_id", document.data.id).eq("status", "current").maybeSingle();
  if (version.error || !version.data?.file_id) return NextResponse.json({ error: "No existe una versión vigente aprobada." }, { status: 404 });
  const file = await admin.from("file_objects").select("bucket_id,object_path").eq("id", version.data.file_id).is("deleted_at", null).maybeSingle();
  if (file.error || !file.data) return NextResponse.json({ error: "El archivo vigente no está disponible." }, { status: 404 });
  const signed = await admin.storage.from(file.data.bucket_id || "integraq-private").createSignedUrl(file.data.object_path, 120);
  if (signed.error || !signed.data) return NextResponse.json({ error: "No fue posible abrir el documento institucional." }, { status: 500 });
  await admin.from("document_audit_log").insert({ document_id: document.data.id, document_version_id: version.data.id, event_type: "DOCUMENT_VIEWED", performed_by: session.authUserId ?? null, metadata: { origin: "home_institutional", position, revision: version.data.revision } });
  return NextResponse.json({ signedUrl: signed.data.signedUrl, expiresIn: 120 });
}
