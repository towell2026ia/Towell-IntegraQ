import { NextResponse } from "next/server";

import type { InstitutionalContentKind, InstitutionalDocumentOption, InstitutionalItem, InstitutionalPosition } from "@/lib/institutional-information-data";
import { isAdministrator } from "@/lib/session-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";

const positions = new Set<InstitutionalPosition>(["POLICY_QUALITY", "CODE_ETHICS", "CONFIDENTIALITY"]);
type ItemRow = { position: InstitutionalPosition; title: string; content_kind: InstitutionalContentKind; document_id: string | null; short_text: string | null; visible_to_internal: boolean; visible_to_external: boolean; active: boolean; display_order: number };
type DocumentRow = { id: string; code: string; title: string; process_id: string; active: boolean; deleted_at: string | null };
type VersionRow = { id: string; document_id: string; revision: number; file_id: string | null; file_name: string; status: string };
type LifecycleRow = { document_id: string; lifecycle_status: string; is_deleted: boolean };

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const admin = createAdminClient();
  const itemsResult = await admin.from("home_institutional_items").select("position,title,content_kind,document_id,short_text,visible_to_internal,visible_to_external,active,display_order").order("display_order");
  if (itemsResult.error) return NextResponse.json({ error: "No fue posible consultar la información institucional." }, { status: 500 });
  const administrator = isAdministrator(session);
  const rows = ((itemsResult.data ?? []) as ItemRow[]).filter((row) => administrator || (row.active && (session.userType === "Usuario interno" ? row.visible_to_internal : row.visible_to_external)));
  const resolved = await resolveDocuments(admin, rows, administrator);
  const items = rows.map((row) => mapItem(row, resolved.documents, resolved.versions, resolved.availableFileIds, resolved.lifecycle)).filter((item) => administrator || item.available);
  return NextResponse.json({ items, documents: administrator ? resolved.catalog : undefined });
}

export async function PATCH(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session || !isAdministrator(session) || !session.authUserId) return NextResponse.json({ error: "Acceso exclusivo para administrador." }, { status: 403 });
  const payload = await request.json().catch(() => null) as Partial<InstitutionalItem> | null;
  if (!payload?.position || !positions.has(payload.position)) return NextResponse.json({ error: "Posición institucional no válida." }, { status: 400 });
  const contentKind = payload.contentKind;
  if (contentKind !== "document" && contentKind !== "text") return NextResponse.json({ error: "Tipo de contenido no válido." }, { status: 400 });
  if (payload.position !== "CONFIDENTIALITY" && contentKind !== "document") return NextResponse.json({ error: "Política de Calidad y Código de Ética deben referenciar un documento controlado." }, { status: 400 });
  const active = Boolean(payload.active);
  const documentId = contentKind === "document" && payload.documentId ? payload.documentId : null;
  const shortText = contentKind === "text" ? payload.shortText?.trim() || null : null;
  const admin = createAdminClient();
  if (active && contentKind === "text" && !shortText) return NextResponse.json({ error: "Escribe la leyenda de confidencialidad." }, { status: 400 });
  if (active && contentKind === "document") {
    if (!documentId) return NextResponse.json({ error: "Selecciona un documento controlado." }, { status: 400 });
    const valid = await currentDocumentIsAvailable(admin, documentId);
    if (!valid) return NextResponse.json({ error: "El documento seleccionado no tiene una versión vigente aprobada disponible." }, { status: 400 });
  }
  const result = await admin.from("home_institutional_items").update({ content_kind: contentKind, document_id: documentId, short_text: shortText, visible_to_internal: Boolean(payload.visibleToInternal), visible_to_external: Boolean(payload.visibleToExternal), active, updated_by: session.authUserId }).eq("position", payload.position).select("position,title,content_kind,document_id,short_text,visible_to_internal,visible_to_external,active,display_order").single();
  if (result.error || !result.data) return NextResponse.json({ error: "No fue posible guardar la referencia institucional." }, { status: 500 });
  const resolved = await resolveDocuments(admin, [result.data as ItemRow], true);
  return NextResponse.json({ item: mapItem(result.data as ItemRow, resolved.documents, resolved.versions, resolved.availableFileIds, resolved.lifecycle) });
}

async function resolveDocuments(admin: ReturnType<typeof createAdminClient>, items: ItemRow[], includeCatalog: boolean) {
  const configuredIds = [...new Set(items.flatMap((item) => item.document_id ? [item.document_id] : []))];
  let documentsQuery = admin.from("controlled_documents").select("id,code,title,process_id,active,deleted_at").eq("active", true).is("deleted_at", null).order("code");
  if (!includeCatalog) documentsQuery = documentsQuery.in("id", configuredIds.length ? configuredIds : ["00000000-0000-0000-0000-000000000000"]);
  const documentsResult = await documentsQuery;
  const documents = (documentsResult.data ?? []) as DocumentRow[];
  const documentIds = documents.map((document) => document.id);
  const [versionsResult, lifecycleResult] = await Promise.all([
    documentIds.length ? admin.from("controlled_document_versions").select("id,document_id,revision,file_id,file_name,status").in("document_id", documentIds).eq("status", "current") : Promise.resolve({ data: [], error: null }),
    documentIds.length ? admin.from("document_lifecycle").select("document_id,lifecycle_status,is_deleted").in("document_id", documentIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const versions = (versionsResult.data ?? []) as VersionRow[];
  const lifecycle = new Map(((lifecycleResult.data ?? []) as LifecycleRow[]).map((row) => [row.document_id, row]));
  const fileIds = versions.flatMap((version) => version.file_id ? [version.file_id] : []);
  const filesResult = fileIds.length ? await admin.from("file_objects").select("id").in("id", fileIds).is("deleted_at", null) : { data: [], error: null };
  if (documentsResult.error || versionsResult.error || lifecycleResult.error || filesResult.error) throw new Error("INSTITUTIONAL_DOCUMENT_RESOLUTION_FAILED");
  const availableFileIds = new Set((filesResult.data ?? []).map((file) => file.id as string));
  const versionMap = new Map(versions.map((version) => [version.document_id, version]));
  const catalog: InstitutionalDocumentOption[] = documents.filter((document) => lifecycleAvailable(lifecycle.get(document.id))).map((document) => { const version = versionMap.get(document.id); return { id: document.id, code: document.code, title: document.title, processId: document.process_id, currentRevision: version?.file_id && availableFileIds.has(version.file_id) ? version.revision : undefined, currentFileName: version?.file_id && availableFileIds.has(version.file_id) ? version.file_name : undefined }; });
  return { documents: new Map(documents.map((document) => [document.id, document])), versions: versionMap, lifecycle, availableFileIds, catalog };
}

function mapItem(row: ItemRow, documents: Map<string, DocumentRow>, versions: Map<string, VersionRow>, availableFileIds: Set<string>, lifecycle: Map<string, LifecycleRow>): InstitutionalItem {
  const document = row.document_id ? documents.get(row.document_id) : undefined;
  const version = row.document_id ? versions.get(row.document_id) : undefined;
  const available = row.active && (row.content_kind === "text" ? Boolean(row.short_text?.trim()) : Boolean(document && version?.file_id && availableFileIds.has(version.file_id) && lifecycleAvailable(lifecycle.get(document.id))));
  return { position: row.position, title: row.title, contentKind: row.content_kind, documentId: row.document_id ?? undefined, shortText: row.short_text ?? undefined, visibleToInternal: row.visible_to_internal, visibleToExternal: row.visible_to_external, active: row.active, available, document: document && version && version.file_id && availableFileIds.has(version.file_id) ? { code: document.code, title: document.title, revision: version.revision, fileName: version.file_name } : undefined };
}

function lifecycleAvailable(lifecycle?: LifecycleRow) { return !lifecycle || (!lifecycle.is_deleted && lifecycle.lifecycle_status === "active"); }

async function currentDocumentIsAvailable(admin: ReturnType<typeof createAdminClient>, documentId: string) {
  const document = await admin.from("controlled_documents").select("id,active,deleted_at").eq("id", documentId).eq("active", true).is("deleted_at", null).maybeSingle();
  if (document.error || !document.data) return false;
  const lifecycle = await admin.from("document_lifecycle").select("lifecycle_status,is_deleted").eq("document_id", documentId).maybeSingle();
  if (lifecycle.error || (lifecycle.data && (lifecycle.data.is_deleted || lifecycle.data.lifecycle_status !== "active"))) return false;
  const version = await admin.from("controlled_document_versions").select("file_id").eq("document_id", documentId).eq("status", "current").maybeSingle();
  if (version.error || !version.data?.file_id) return false;
  const file = await admin.from("file_objects").select("id").eq("id", version.data.file_id).is("deleted_at", null).maybeSingle();
  return !file.error && Boolean(file.data);
}
