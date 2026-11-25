import "server-only";

import { isWorkspaceModuleId } from "@/lib/navigation";
import type {
  ActiveSession,
  ModulePermissionAction,
  UserType,
} from "@/lib/session-data";
import { createClient } from "@/lib/supabase/server";

type ProfileRow = {
  organization_id: string | null;
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
  external_site_id: string | null;
  external_party: {
    code: string;
    name: string;
    kind: "internal" | "customer" | "supplier";
  } | null;
  external_site: {
    code: string;
    name: string;
  } | null;
  workspace_mode?: "demo" | "production" | null;
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

export async function getAuthenticatedSession(timing?: (phase: string, ms: number) => void): Promise<ActiveSession | null> {
  return (await getVerifiedSessionContext(timing))?.session ?? null;
}

// Only server callers receive this request's RLS-verified profile and client.
export async function getVerifiedSessionContext(timing?: (phase: string, ms: number) => void) {
  const started = performance.now();
  const supabase = await createClient();
  const { data: claimData, error: claimsError } = await supabase.auth.getClaims();
  const claimsChecked = performance.now();
  timing?.("identity", claimsChecked - started);
  const claims = claimData?.claims;

  if (claimsError && ((claimsError.status ?? 0) >= 500 || claimsError.name === "AuthRetryableFetchError")) {
    return { session: null, supabase, profile: null, failure: "unavailable" as const };
  }
  if (claimsError || !claims?.sub) return null;

  // Resolve the verified profile and its permission rows in the same RLS snapshot.
  const { data: profileData, error: profileError } = await supabase.from("profiles")
    .select(`*, external_party:organizations!profiles_external_party_id_fkey(code,name,kind),
      external_site:external_company_sites!profiles_external_site_id_fkey(code,name),
      processes:user_process_permissions!user_process_permissions_user_id_fkey(process_id,document_role),
      modules:user_module_permissions!user_module_permissions_user_id_fkey(module_id,can_view),
      actions:user_module_action_permissions!user_module_action_permissions_user_id_fkey(module_id,action,source),
      overrides:user_permission_overrides!user_permission_overrides_user_id_fkey(allowed,permission:permissions(code))`)
    .eq("id", claims.sub)
    .eq("modules.can_view", true)
    .maybeSingle();
  if (profileError) throw new Error("No fue posible verificar los permisos de la sesión.");
  const processData: { process_id: string; document_role: string }[] | undefined = profileData?.processes;
  const moduleData: { module_id: string }[] | undefined = profileData?.modules;
  const moduleActionData: { module_id: string; action: string; source: string }[] | undefined = profileData?.actions;
  type Permission = { code: string };
  const specificPermissionData: { allowed: boolean; permission: Permission | Permission[] | null }[] | undefined = profileData?.overrides;
  timing?.("permissions", performance.now() - claimsChecked);
  const profile = profileData as ProfileRow | null;
  if (profile?.status === "inactive") return { session: null, supabase, profile: null, failure: "inactive" as const };
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
          source: row.source as "position" | "direct" | "system",
        }]
      : [];
  });
  const specificPermissions = Object.fromEntries(
    (specificPermissionData ?? []).flatMap((row) => {
      const relation = Array.isArray(row.permission) ? row.permission[0] : row.permission;
      return relation?.code ? [[relation.code, row.allowed]] : [];
    }),
  );

  const session: ActiveSession = {
    userId: profile?.external_id || claims.sub,
    authUserId: claims.sub,
    organizationId: profile?.organization_id ?? undefined,
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
    specificPermissions,
    positionId: profile?.position_id || undefined,
    documentAccess,
    continuousImprovementRole:
      profile?.continuous_improvement_role || undefined,
    workspaceMode:
      profile?.workspace_mode === "demo" || appMetadata.workspace_mode === "demo"
        ? "demo"
        : "production",
    externalParty:
      profile?.external_party_kind &&
      profile.external_party_id &&
      (profile.external_party?.name || profile.external_party_name)
        ? {
            kind: profile.external_party_kind,
            companyId: profile.external_party_id,
            companyCode: profile.external_party?.code,
            companyName:
              profile.external_party?.name || profile.external_party_name || "",
            siteId: profile.external_site_id || undefined,
            siteCode: profile.external_site?.code,
            siteName: profile.external_site?.name,
          }
        : undefined,
  };
  return { session, supabase, profile: profile && {
    id: claims.sub, organization_id: profile.organization_id, user_type: profile.user_type,
    status: profile.status, workspace_mode: profile.workspace_mode, external_party_id: profile.external_party_id,
  } };
}
