import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActiveSession } from "./session-data";
import { canReadControlledCatalog, getDocumentPermissions } from "./document-control-data";

export const qualityPolicyDocumentId = "217affe6-5187-4d98-a588-d1e17d2347a8";
const policyProcess = "P-35";

export function canReadQualityPolicy(session: ActiveSession) {
  return session.workspaceMode === "production" && !!session.authUserId && !!session.organizationId &&
    canReadControlledCatalog(session) && getDocumentPermissions(session, policyProcess).view;
}

// The caller supplies the session's RLS client and only the fields its view needs.
export function qualityPolicyQuery(db: SupabaseClient, session: ActiveSession, fields: string) {
  if (!canReadQualityPolicy(session)) throw Object.assign(new Error("Sin acceso documental."), { code: "42501" });
  return db.from("controlled_documents").select(fields + ",process:processes!inner(organization_id)")
    .eq("id", qualityPolicyDocumentId).eq("code", "AV-SGC-0").eq("process_id", policyProcess)
    .eq("process.organization_id", session.organizationId!)
    .or("organization_id.is.null,organization_id.eq." + session.organizationId)
    .eq("active", true).is("deleted_at", null).eq("versions.status", "current").maybeSingle();
}

export function currentPolicyVersion<T extends { status: string }>(versions: readonly T[]) {
  const current = versions.filter(version => version.status === "current");
  if (current.length > 1) throw new Error("La Política de Calidad tiene más de una revisión vigente.");
  return current[0];
}
