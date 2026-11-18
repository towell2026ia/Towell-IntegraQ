import { NextResponse } from "next/server";

import { canHardDeleteCorrectiveAction, validateHardDeleteConfirmation } from "@/lib/root2cause/hard-delete";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const noStore = { "Cache-Control": "no-store" };
const privateBucket = "integraq-private";
const allowedPath = /^[^/]+\/attachments\/corrective-actions\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.\/-]+$/;
function isSafeObjectPath(value: unknown): value is string {
  return typeof value === "string" && allowedPath.test(value) && !value.split("/").some((segment) => segment === ".." || segment === ".") && !value.includes("//");
}

function statusFor(message: string) {
  if (message.includes("ADMIN_REQUIRED") || message.includes("EXPLICIT_DELETE_PERMISSION_REQUIRED") || message.includes("OUTSIDE_PROCESS_SCOPE")) return 403;
  if (message.includes("ACTION_NOT_FOUND")) return 404;
  if (message.includes("REFERENCED_BY_OTHER") || message.includes("REFERENCED_IN_OTHER") || message.includes("REFERENCED_EXTERNALLY") || message.includes("FILE_REFERENCED") || message.includes("UNSUPPORTED_") || message.includes("UNVERIFIED") || message.includes("UNSAFE_") || message.includes("SCOPE_MISMATCH") || message.includes("SHARED_WITH_OTHER_ACTION") || message.includes("EVIDENCE_SHARED") || message.includes("DUPLICATE_ACTION") || message.includes("FOLIO_CONFLICT") || message.includes("MANIFEST_CHANGED") || message.includes("IN_PROGRESS") || message.includes("CHANGED_DURING_DELETE") || message.includes("CHANGED_OR_NOT_FOUND") || message.includes("IDENTITY_MISMATCH")) return 409;
  if (message.includes("FOLIO_AND_REASON_REQUIRED")) return 400;
  return 503;
}

export async function DELETE(request: Request, context: { params: Promise<{ actionId: string }> }) {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) return NextResponse.json({ error: "Sesión requerida." }, { status: 401, headers: noStore });
  if (!canHardDeleteCorrectiveAction(session)) return NextResponse.json({ error: "Se requiere un administrador con permiso explícito de administración de Root2Cause." }, { status: 403, headers: noStore });
  if (process.env.ROOT2CAUSE_HARD_DELETE_ENABLED !== "true") {
    return NextResponse.json({ error: "La eliminación definitiva permanece desactivada mientras se completan sus pruebas funcionales y de Storage." }, { status: 503, headers: noStore });
  }

  const { actionId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actionId)) {
    return NextResponse.json({ error: "Identificador de acción inválido." }, { status: 400, headers: noStore });
  }
  const body = await request.json().catch(() => null) as { folio?: unknown; reason?: unknown; folioConfirmation?: unknown } | null;
  if (!body || typeof body.folio !== "string" || typeof body.reason !== "string" || typeof body.folioConfirmation !== "string") {
    return NextResponse.json({ error: "Código AC y motivo de eliminación obligatorios." }, { status: 400, headers: noStore });
  }
  const validation = validateHardDeleteConfirmation({ actionId, folio: body.folio, reason: body.reason, folioConfirmation: body.folioConfirmation });
  if (validation) return NextResponse.json({ error: validation }, { status: 400, headers: noStore });

  const db = await createClient();
  const begun = await db.rpc("iq_root2cause_hard_delete_begin", {
    p_action_id: actionId,
    p_folio: body.folio,
    p_reason: body.reason.trim(),
  });
  if (begun.error) return NextResponse.json({ error: begun.error.message, code: "HARD_DELETE_BLOCKED" }, { status: statusFor(begun.error.message), headers: noStore });

  const operation = begun.data as { operationId?: unknown; status?: unknown; paths?: unknown } | null;
  if (!operation || typeof operation.operationId !== "string" || !Array.isArray(operation.paths) || operation.paths.some((path) => !isSafeObjectPath(path))) {
    if (operation && typeof operation.operationId === "string") {
      await db.rpc("iq_root2cause_hard_delete_storage_failed", { p_operation_id: operation.operationId, p_error: "La reserva devolvió un manifiesto de Storage no verificable." });
    }
    return NextResponse.json({ error: "La reserva de eliminación devolvió rutas no verificables. El expediente no fue eliminado." }, { status: 503, headers: noStore });
  }
  if (operation.status === "completed") return NextResponse.json({ deleted: true, folio: body.folio, alreadyCompleted: true }, { headers: noStore });

  const paths = [...new Set(operation.paths as string[])];
  if (paths.length) {
    try {
      const storage = createAdminClient().storage.from(privateBucket);
      for (let offset = 0; offset < paths.length; offset += 1000) {
        const removed = await storage.remove(paths.slice(offset, offset + 1000));
        if (removed.error) throw removed.error;
      }
      for (const path of paths) {
        const separator = path.lastIndexOf("/");
        const parent = separator >= 0 ? path.slice(0, separator) : "";
        const filename = separator >= 0 ? path.slice(separator + 1) : path;
        const listed = await storage.list(parent, { search: filename, limit: 100, offset: 0 });
        if (listed.error) throw listed.error;
        if ((listed.data ?? []).some((storageObject) => storageObject.name === filename)) {
          throw new Error("Storage aún devuelve un objeto del manifiesto.");
        }
      }
    } catch (error) {
      const safeError = error instanceof Error && "statusCode" in error ? `Storage respondió con estado ${String(error.statusCode).slice(0, 20)}.` : "Storage no confirmó la limpieza.";
      await db.rpc("iq_root2cause_hard_delete_storage_failed", { p_operation_id: operation.operationId, p_error: safeError });
      const retryState = await db.rpc("iq_root2cause_hard_delete_begin", { p_action_id: actionId, p_folio: body.folio, p_reason: body.reason.trim() });
      if (!retryState.error && (retryState.data as { status?: unknown } | null)?.status === "completed") {
        return NextResponse.json({ deleted: true, folio: body.folio, alreadyCompleted: true }, { headers: noStore });
      }
      return NextResponse.json({ error: "Storage no confirmó la eliminación de todos los archivos. El expediente permanece sin eliminar y la operación quedó pendiente para reintento administrativo.", cleanupPending: true }, { status: 503, headers: noStore });
    }
  }

  // Completion uses only the server-held service_role client. The actor ID
  // comes from the authenticated server session, never from the request body.
  const completed = await createAdminClient().rpc("iq_root2cause_hard_delete_complete", {
    p_operation_id: operation.operationId,
    p_actor_id: session.authUserId,
  });
  if (completed.error) {
    await db.rpc("iq_root2cause_hard_delete_storage_failed", { p_operation_id: operation.operationId, p_error: "Storage se limpió, pero PostgreSQL no confirmó el cierre; reintentar la misma operación." });
    const retryState = await db.rpc("iq_root2cause_hard_delete_begin", { p_action_id: actionId, p_folio: body.folio, p_reason: body.reason.trim() });
    if (!retryState.error && (retryState.data as { status?: unknown } | null)?.status === "completed") {
      return NextResponse.json({ deleted: true, folio: body.folio, alreadyCompleted: true }, { headers: noStore });
    }
    return NextResponse.json({ error: "Storage se limpió, pero PostgreSQL no confirmó el borrado. El expediente no se reporta como eliminado; reintenta la operación pendiente.", cleanupPending: true }, { status: 503, headers: noStore });
  }
  return NextResponse.json({ ...(completed.data as Record<string, unknown>), folio: body.folio }, { headers: noStore });
}
