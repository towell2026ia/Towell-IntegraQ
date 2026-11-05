import "server-only";

import type { ActiveSession } from "@/lib/session-data";
import { canAccessModule } from "@/lib/access-policy";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CustomerPortalActor = {
  kind: "customer" | "administrator";
  userId: string;
  companyId?: string;
  workspaceId: string;
};

export function customerPortalDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export async function resolveCustomerPortalActor(session: ActiveSession | null): Promise<CustomerPortalActor | null> {
  if (!session?.authUserId || session.workspaceMode !== "production" || !canAccessModule(session, "customer-portal")) return null;
  const admin = createAdminClient();
  const profileResult = await admin.from("profiles")
    .select("user_type,status,workspace_mode,organization_id,external_party_kind,external_party_id")
    .eq("id", session.authUserId).maybeSingle();
  const profile = profileResult.data;
  if (profileResult.error || !profile || profile.status !== "active" || profile.workspace_mode === "demo") return null;

  if (session.userType === "Administrador" && profile.user_type === "administrator" && profile.organization_id) {
    return { kind: "administrator", userId: session.authUserId, workspaceId: profile.organization_id };
  }

  if (session.userType !== "Cliente" || profile.user_type !== "customer" ||
      profile.external_party_kind !== "customer" || session.externalParty?.kind !== "customer" ||
      !profile.external_party_id || !uuid.test(profile.external_party_id) ||
      profile.external_party_id !== session.externalParty.companyId) return null;

  const companyResult = await admin.from("organizations")
    .select("id,kind,active,owning_organization_id")
    .eq("id", profile.external_party_id).maybeSingle();
  const company = companyResult.data;
  if (companyResult.error || !company || company.id !== profile.external_party_id || company.kind !== "customer" ||
      company.active !== true || !company.owning_organization_id) return null;
  return { kind: "customer", userId: session.authUserId, companyId: company.id, workspaceId: company.owning_organization_id };
}