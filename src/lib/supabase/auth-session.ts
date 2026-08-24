import "server-only";

import { isWorkspaceModuleId } from "@/lib/navigation";
import type {
  ActiveSession,
  ModulePermissionAction,
  UserType,
} from "@/lib/session-data";
import { createClient } from "@/lib/supabase/server";

type ProfileRow = {
  external_id: string | null;
  full_name: string;
  short_name: string | null;
  initials: string | null;
  position_id: string | null;
  position_name: string | null;
  department: string | null;
  company: string | null;
  site: string | null;
  user_type: "administrator" | "internal" | "customer" | "supplier";
  status: "active" | "inactive";
  continuous_improvement_role: "submitter" | "manager" | null;
  external_party_kind: "customer" | "supplier" | null;
  external_party_id: string | null;
  external_party_name: string | null;
  external_party: {
    code: string;
    name: string;
    kind: "internal" | "customer" | "supplier";
  } | null;
};

const userTypeLabels: Record<ProfileRow["user_type"], UserType> = {
  administrator: "Administrador",
  internal: "Usuario interno",
  customer: "Cliente",
  supplier: "Proveedor",
};

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("es"))
    .join("");
}

function shortNameFor(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length > 2 ? `${parts[0]} ${parts[1][0]}. ${parts.at(-1)}` : name;
}

export async function getAuthenticatedSession(): Promise<ActiveSession | null> {
  const supabase = await createClient();
  const { data: claimData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimData?.claims;

  if (claimsError || !claims?.sub) return null;

  const [
    { data: profileData },
    { data: processData },
    { data: moduleData },
    { data: moduleActionData },
  ] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("*, external_party:organizations!profiles_external_party_id_fkey(code,name,kind)")
        .eq("id", claims.sub)
        .maybeSingle(),
      supabase
        .from("user_process_permissions")
        .select("process_id, document_role")
        .eq("user_id", claims.sub),
      supabase
        .from("user_module_permissions")
        .select("module_id, can_view")
        .eq("user_id", claims.sub)
        .eq("can_view", true),
      supabase
        .from("user_module_action_permissions")
        .select("module_id, action")
        .eq("user_id", claims.sub),
    ]);

  const profile = profileData as ProfileRow | null;
  if (profile?.status === "inactive") return null;
  const userMetadata = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const appMetadata = (claims.app_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    profile?.full_name ||
    (typeof userMetadata.full_name === "string"
      ? userMetadata.full_name
      : "Usuario IntegraQ");
  const rawUserType = profile?.user_type ??
    (appMetadata.user_type === "administrator" ||
    appMetadata.user_type === "internal" ||
    appMetadata.user_type === "customer" ||
    appMetadata.user_type === "supplier"
      ? appMetadata.user_type
      : "internal");

  const assignedProcessIds = (processData ?? []).map(
    (row) => row.process_id as string,
  );
  const documentAccess = (processData ?? []).map((row) => ({
    processId: row.process_id as string,
    role: row.document_role as "viewer" | "modifier" | "authorizer",
    inheritedFromPositionId: profile?.position_id ?? "ASIGNACION-DIRECTA",
  }));
  const assignedModuleIds = (moduleData ?? [])
    .map((row) => row.module_id as string)
    .filter(isWorkspaceModuleId);
  const moduleActionPermissions = (moduleActionData ?? []).flatMap((row) => {
    const moduleId = row.module_id as string;
    return isWorkspaceModuleId(moduleId)
      ? [{
          moduleId,
          action: row.action as ModulePermissionAction,
        }]
      : [];
  });

  return {
    userId: profile?.external_id || claims.sub,
    authUserId: claims.sub,
    name: fullName,
    shortName: profile?.short_name || shortNameFor(fullName),
    initials: profile?.initials || initialsFor(fullName),
    position: profile?.position_name || "Puesto pendiente de asignar",
    department: profile?.department || "Sin departamento asignado",
    company: profile?.company || "Towell",
    site: profile?.site || undefined,
    userType: userTypeLabels[rawUserType],
    assignedProcessIds,
    assignedModuleIds,
    moduleActionPermissions,
    positionId: profile?.position_id || undefined,
    documentAccess,
    continuousImprovementRole:
      profile?.continuous_improvement_role || undefined,
    externalParty:
      profile?.external_party_kind &&
      profile.external_party_id &&
      (profile.external_party?.name || profile.external_party_name)
        ? {
            kind: profile.external_party_kind,
            companyId: profile.external_party?.code || profile.external_party_id,
            companyName:
              profile.external_party?.name || profile.external_party_name || "",
          }
        : undefined,
  };
}
