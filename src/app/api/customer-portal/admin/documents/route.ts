import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveCustomerPortalActor } from "@/lib/customer-portal-server";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";

import { requireIndividualPublication, PublicationUnavailable } from "@/lib/customer-portal-contract-server";

export const maxDuration = 60;
const maxBytes = 25 * 1024 * 1024;

class AdministratorRequired extends Error {}

async function requirePortalAdministrator() {
  const actor = await resolveCustomerPortalActor(await getAuthenticatedSession());
  if (actor?.kind !== "administrator") throw new AdministratorRequired();
  await requireIndividualPublication();
  return { id: actor.userId, workspaceId: actor.workspaceId };
}

export async function GET(request: Request) {
  try {
    const actor = await requirePortalAdministrator();
    const db = createAdminClient();
    const customerId = new URL(request.url).searchParams.get("customerId");
    const general = new URL(request.url).searchParams.get("scope") === "general";
    if (general && customerId) return NextResponse.json({error:"Alcance incompatible."},{status:400});
    const customers = await db.from("organizations").select("id,name,code")
      .eq("owning_organization_id", actor.workspaceId).eq("kind", "customer").eq("active", true).order("name");
    if (customers.error) throw customers.error;
    if (!customerId && !general) return NextResponse.json({ available: true, customers: customers.data ?? [], publications: [] }, { headers: { "Cache-Control": "private, no-store" } });
    if (!general && !customers.data?.some(customer => customer.id === customerId)) return NextResponse.json({ error: "Cliente no pertenece a esta organización." }, { status: 404 });
    let pubs = db.from("customer_portal_document_publications")
      .select("id,customer_id,display_name,description,version,status,file_id,created_at,published_at,withdrawn_at,withdrawal_reason,created_by,published_by,withdrawn_by,revision")
      .eq("workspace_id", actor.workspaceId);
    pubs = general ? pubs.eq("publication_scope","general").is("customer_id",null) : pubs.eq("customer_id",customerId);
    const result = await pubs.order("created_at", { ascending: false });
    if (result.error) throw result.error;
    const publicationRows = result.data ?? [];
    const fileIds = publicationRows.map(row => row.file_id).filter((id): id is string => typeof id === "string");
    const fileQuery = db.from("file_objects").select("id,original_name,size_bytes")
      .eq("workspace_id", actor.workspaceId)
      .eq("resource_type", "customer_portal_document").in("id", fileIds);
    const files = fileIds.length ? await (general ? fileQuery.is("external_organization_id",null) : fileQuery.eq("external_organization_id",customerId)) : {data:[],error:null};
    if (files.error) throw files.error;
    const actorIds = [...new Set(publicationRows.flatMap(row => [row.created_by, row.published_by, row.withdrawn_by].filter((id): id is string => typeof id === "string")))];
    const actorRows = actorIds.length ? await db.from("profiles").select("id,full_name").in("id", actorIds) : { data: [], error: null };
    if (actorRows.error) throw actorRows.error;
    return NextResponse.json({ available: true, customers: customers.data ?? [], publications: publicationRows.map(row => ({ ...row,
      original_name: files.data?.find(file => file.id === row.file_id)?.original_name,
      size_bytes: files.data?.find(file => file.id === row.file_id)?.size_bytes,
      created_by_name: actorRows.data?.find(profile => profile.id === row.created_by)?.full_name,
      published_by_name: actorRows.data?.find(profile => profile.id === row.published_by)?.full_name,
      withdrawn_by_name: actorRows.data?.find(profile => profile.id === row.withdrawn_by)?.full_name })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  let uploadedPath: string | undefined;
  try {
    const actor = await requirePortalAdministrator();
    const form = await request.formData();
    const file = form.get("file");
    const customerId = String(form.get("customerId") ?? "");
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if (!(file instanceof File) || !name || file.size <= 0 || file.size > maxBytes || file.type !== "application/pdf") {
      return NextResponse.json({ error: "Selecciona un PDF válido de hasta 25 MB y proporciona su nombre." }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return NextResponse.json({ error: "El contenido no corresponde a un PDF válido." }, { status: 400 });
    const db = createAdminClient();
    const scope = form.get("scope") ?? "individual";
    const general = scope === "general";
    if ((scope !== "individual" && !general) || (general && customerId)) return NextResponse.json({error:"Alcance inválido."},{status:400});
    if (!general) {
    const customer = await db.from("organizations").select("id").eq("id", customerId).eq("kind", "customer")
      .eq("owning_organization_id", actor.workspaceId).eq("active", true).maybeSingle();
    if (customer.error || !customer.data) return NextResponse.json({ error: "Cliente no autorizado." }, { status: 404 });
    }
    const id = randomUUID();
    const objectPath = `customer-portal/${actor.workspaceId}/${general ? "general" : customerId}/${id}.pdf`;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const upload = await db.storage.from("integraq-private").upload(objectPath, bytes, { contentType: "application/pdf", upsert: false });
    if (upload.error) throw upload.error;
    const result = await db.rpc(general ? "iq_customer_portal_document_record_scoped" : "iq_customer_portal_document_record", {
      ...(general ? {p_scope:"general"} : {}),
      p_actor_id: actor.id, p_workspace_id: actor.workspaceId, p_customer_id: general ? null : customerId, p_object_path: objectPath,
      p_original_name: file.name.slice(0, 240), p_display_name: name.slice(0, 200), p_description: description.slice(0, 1000) || null,
      p_size_bytes: bytes.byteLength, p_sha256: sha256, p_mime_type: "application/pdf",
      p_previous_publication_id: String(form.get("previousPublicationId") ?? "") || null,
    });
    if (result.error) {
      // A PostgreSQL error confirms the transaction rolled back. A transport
      // failure can arrive after commit, so keep the private object in that case.
      if (/^[0-9A-Z]{5}$/.test(result.error.code ?? "")) uploadedPath = objectPath;
      throw result.error;
    }
    return NextResponse.json({ publication: result.data }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (uploadedPath) {
      const cleanup = await createAdminClient().storage.from("integraq-private").remove([uploadedPath]);
      if (cleanup.error) console.error("Customer portal upload cleanup required", { path: uploadedPath, reason: cleanup.error.message });
    }
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requirePortalAdministrator();
    const body = await request.json() as { scope?: "general" | "individual"; action?: string; id?: string; reason?: string; revision?: number };
    if (!body.id || !["publish", "withdraw"].includes(body.action ?? "") || !Number.isInteger(body.revision)) {
      return NextResponse.json({ error: "Solicitud de publicación inválida." }, { status: 400 });
    }
    if (body.action === "withdraw" && !body.reason?.trim()) return NextResponse.json({ error: "El motivo de retiro es obligatorio." }, { status: 400 });
    if (body.scope && !["general","individual"].includes(body.scope)) return NextResponse.json({error:"Alcance inválido."},{status:400});
    const result = await createAdminClient().rpc(body.scope === "general" ? "iq_customer_portal_document_transition_scoped" : "iq_customer_portal_document_transition", {
      ...(body.scope === "general" ? {p_scope:"general"} : {}),
      p_actor_id: actor.id, p_workspace_id: actor.workspaceId, p_publication_id: body.id,
      p_action: body.action, p_reason: body.reason?.trim() || null, p_expected_revision: body.revision,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ publication: result.data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  let status = 500;
  let message = "No fue posible completar la operación del portal.";
  if (error instanceof PublicationUnavailable) {
    status = 503;
    message = error.message;
  } else if (error instanceof AdministratorRequired) {
    status = 403;
    message = "Acción exclusiva para administradores del portal.";
  } else if (typeof error === "object" && error && "message" in error) {
    switch (error.message) {
      case "CUSTOMER_PORTAL_REVISION_CONFLICT": status = 409; message = "La publicación cambió. Recarga antes de continuar."; break;
      case "CUSTOMER_PORTAL_PUBLICATION_NOT_FOUND": status = 404; message = "Publicación no disponible."; break;
      case "CUSTOMER_PORTAL_ADMIN_REQUIRED":
      case "CUSTOMER_PORTAL_CUSTOMER_SCOPE": status = 403; message = "Acceso al destinatario denegado."; break;
      case "CUSTOMER_PORTAL_TRANSITION_INVALID":
      case "CUSTOMER_PORTAL_VERSION_PARENT_INVALID":
      case "CUSTOMER_PORTAL_FILE_INVALID": status = 400; message = "Revisa el estado, archivo y versión de la publicación."; break;
    }
  }
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}
