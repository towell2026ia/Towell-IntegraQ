import { NextResponse } from "next/server";

import {
  GeneralInformationApiError,
  generalInformationErrorResponse,
  requireGeneralInformationActor,
} from "@/lib/general-information-server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const actor = await requireGeneralInformationActor();
    const disposition = new URL(request.url).searchParams.get("disposition") === "download" ? "download" : "preview";
    if (disposition === "download" && !actor.administrator) {
      throw new GeneralInformationApiError("La descarga está reservada al administrador.", 403);
    }
    const { documentId } = await params;
    const admin = createAdminClient();
    const record = await admin.from("file_objects")
      .select("id,bucket_id,object_path,original_name,preview_path,preview_status,deleted_at")
      .eq("id", documentId)
      .eq("workspace_id", actor.workspaceId)
      .eq("resource_type", "general_information_document")
      .eq("is_current", true)
      .maybeSingle();
    if (record.error) throw record.error;
    if (!record.data || record.data.deleted_at) throw new GeneralInformationApiError("Documento no disponible.", 404);
    const path = disposition === "preview" && record.data.preview_status === "ready" && record.data.preview_path
      ? record.data.preview_path
      : record.data.object_path;
    const signed = await admin.storage.from(record.data.bucket_id || "integraq-private").createSignedUrl(
      path,
      disposition === "download" ? 60 : 120,
      disposition === "download" ? { download: record.data.original_name } : { download: false },
    );
    if (signed.error) throw signed.error;
    if (disposition === "download") {
      const logged = await admin.from("audit_log").insert({
        actor_id: actor.id,
        action: "DOWNLOAD_DOCUMENT",
        resource_type: "general_information_document",
        resource_id: record.data.id,
        metadata: { workspace_id: actor.workspaceId },
      });
      if (logged.error) throw logged.error;
    }
    return NextResponse.json({ signedUrl: signed.data.signedUrl, expiresIn: disposition === "download" ? 60 : 120 });
  } catch (error) {
    console.error("No fue posible autorizar el archivo de Información General.", error);
    const response = generalInformationErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
