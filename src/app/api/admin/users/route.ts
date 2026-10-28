import { effectiveSpecificPermissions } from "@/lib/access-permissions";
import { NextResponse } from "next/server";

import { processCatalog } from "@/lib/configuration-data";
import { normalizeModulePermissions } from "@/lib/module-permissions";
import {
  workspaceModuleMeta,
  isWorkspaceModuleId,
  type WorkspaceModuleId,
} from "@/lib/navigation";
import type {
  ModulePermissionAction,
  UserType,
} from "@/lib/session-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  editableSpecificPermissionKeys,
  type SpecificPermissionKey,
} from "@/lib/specific-permissions";
import type { UserAccessAccount } from "@/lib/user-access-data";

export const maxDuration = 30;

const userTypeFromDatabase: Record<
  "administrator" | "internal" | "customer" | "supplier",
  UserType
> = {
  administrator: "Administrador",
  internal: "Usuario interno",
  customer: "Cliente",
  supplier: "Proveedor",
};

const userTypeToDatabase: Record<
  UserType,
  "administrator" | "internal" | "customer" | "supplier"
> = {
  Administrador: "administrator",
  "Usuario interno": "internal",
  Cliente: "customer",
  Proveedor: "supplier",
};

type ProfileRow = {
  id: string;
  external_id: string;
  full_name: string;
  position_id: string | null;
  position_name: string | null;
  department: string | null;
  company: string | null;
  user_type: keyof typeof userTypeFromDatabase;
  status: "active" | "inactive";
  continuous_improvement_role: "submitter" | "manager" | null;
  external_party_id: string | null;
  external_party_name: string | null;
  external_site_id: string | null;
  created_at: string;
  updated_at: string;
};

async function requireUserPermission(permission: SpecificPermissionKey) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_type,status,workspace_mode")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profile?.status !== "active") return null;
  if (profile.user_type === "administrator") return { ...userData.user, workspaceMode: profile.workspace_mode ?? "production" };
  if (profile.user_type !== "internal" || profile.workspace_mode === "demo") return null;
  const { data: allowed } = await supabase.rpc("has_permission", {
    requested_permission: permission,
  });
  return allowed === true ? { ...userData.user, workspaceMode: profile.workspace_mode ?? "production" } : null;
}

export async function GET() {
  try {
    return await listAccounts();
  } catch (error) {
    console.error("No fue posible consultar las cuentas de acceso.", error);
    return NextResponse.json(
      { error: "No fue posible consultar los usuarios." },
      { status: 500 },
    );
  }
}

async function listAccounts() {
  const actor = await requireUserPermission("usuarios.ver");
  if (!actor) {
    return NextResponse.json({ error: "Acceso exclusivo para administrador." }, { status: 403 });
  }
  const admin = createAdminClient();
  const [
    profilesResult,
    positionsResult,
    processPermissionsResult,
    modulePermissionsResult,
    moduleActionsResult,
    permissionOverridesResult,
    externalSitesResult,
    authUsersResult,
  ] = await Promise.all([
    admin.from("profiles").select("id,external_id,full_name,position_id,position_name,department,company,user_type,status,continuous_improvement_role,external_party_id,external_party_name,external_site_id,created_at,updated_at").eq("workspace_mode", actor.workspaceMode).order("full_name"),
    admin.from("positions").select("id,name,branch"),
    admin.from("user_process_permissions").select("user_id,process_id,document_role,inherited_from_position_id"),
    admin.from("user_module_permissions").select("user_id,module_id,can_view"),
    admin.from("user_module_action_permissions").select("user_id,module_id,action"),
    admin.from("user_permission_overrides").select("user_id,allowed,permission:permissions(code)"),
    admin.from("external_company_sites").select("id,code,name,company_id"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const firstError = [
    profilesResult.error,
    positionsResult.error,
    processPermissionsResult.error,
    modulePermissionsResult.error,
    moduleActionsResult.error,
    permissionOverridesResult.error,
    externalSitesResult.error,
    authUsersResult.error,
  ].find(Boolean);
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  const positions = new Map(
    (positionsResult.data ?? []).map((position) => [position.id, position]),
  );
  const emails = new Map(
    (authUsersResult.data.users ?? []).map((user) => [user.id, user.email ?? ""]),
  );
  const allModuleIds = Object.keys(workspaceModuleMeta) as WorkspaceModuleId[];
  const externalSites = new Map((externalSitesResult.data ?? []).map((site) => [site.id, site]));

  const accounts = ((profilesResult.data ?? []) as ProfileRow[]).map((profile) => {
    const position = profile.position_id ? positions.get(profile.position_id) : null;
    const documentAccess = (processPermissionsResult.data ?? [])
      .filter((permission) => permission.user_id === profile.id)
      .map((permission) => ({
        processId: permission.process_id,
        role: permission.document_role as "viewer" | "modifier" | "authorizer",
        inheritedFromPositionId:
          permission.inherited_from_position_id ?? "ASIGNACION-DIRECTA",
      }));
    const moduleActionPermissions = normalizeModulePermissions(
      [
        ...(modulePermissionsResult.data ?? []).filter((p) => p.user_id === profile.id && p.can_view).map((p) => ({ user_id: p.user_id, module_id: p.module_id, action: "view" })),
        ...(moduleActionsResult.data ?? []),
      ]
        .filter((permission) => permission.user_id === profile.id)
        .flatMap((permission) =>
          isWorkspaceModuleId(permission.module_id)
            ? [{
                moduleId: permission.module_id,
                action: permission.action as ModulePermissionAction,
              }]
            : [],
        ),
    );
    const assignedModuleIds = profile.user_type === "administrator"
      ? allModuleIds
      : (modulePermissionsResult.data ?? [])
          .filter(
            (permission) =>
              permission.user_id === profile.id && permission.can_view,
          )
          .map((permission) => permission.module_id)
          .filter(isWorkspaceModuleId);

    return {
      ...(() => {
        const site = profile.external_site_id ? externalSites.get(profile.external_site_id) : undefined;
        return { siteId: site?.id, siteCode: site?.code, siteName: site?.name };
      })(),
      id: profile.external_id,
      authUserId: profile.id,
      fullName: profile.full_name,
      email: emails.get(profile.id) ?? "",
      userType: userTypeFromDatabase[profile.user_type],
      positionId: profile.position_id ?? undefined,
      positionName: position?.name ?? profile.position_name ?? undefined,
      branch: position?.branch ?? profile.department ?? undefined,
      companyId: profile.external_party_id ?? undefined,
      companyName: profile.external_party_name ?? profile.company ?? undefined,
      status: profile.status,
      assignedProcessIds:
        profile.user_type === "administrator"
          ? processCatalog.map((process) => process.id)
          : documentAccess.map((permission) => permission.processId),
      assignedModuleIds,
      moduleActionPermissions,
      documentAccess,
      continuousImprovementRole:
        profile.continuous_improvement_role ?? undefined,
      specificPermissions: effectiveSpecificPermissions({ userType: userTypeFromDatabase[profile.user_type], assignedModuleIds, moduleActionPermissions, specificPermissions: Object.fromEntries((permissionOverridesResult.data ?? []).filter((r) => r.user_id === profile.id).map((r) => { const rel = Array.isArray(r.permission) ? r.permission[0] : r.permission; return [rel?.code, r.allowed]; })) }),
      accessRevision: profile.updated_at,
      createdAt: profile.created_at,
    } satisfies UserAccessAccount;
  });

  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  return handleAccountRequest(request, true);
}

export async function PATCH(request: Request) {
  return handleAccountRequest(request, false);
}

async function handleAccountRequest(request: Request, create: boolean) {
  try {
    return await saveAccount(request, create);
  } catch (error) {
    console.error("No fue posible guardar la cuenta de acceso.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : "No fue posible completar el alta del usuario.",
      },
      { status: 500 },
    );
  }
}

async function saveAccount(request: Request, create: boolean) {
  const actor = await requireUserPermission(
    create ? "usuarios.crear" : "usuarios.administrar_permisos",
  );
  if (!actor) {
    return NextResponse.json({ error: "Acceso exclusivo para administrador." }, { status: 403 });
  }
  const account = (await request.json()) as UserAccessAccount;
  if (!account.fullName?.trim() || !account.email?.trim()) {
    return NextResponse.json({ error: "Nombre y correo son obligatorios." }, { status: 400 });
  }
  if (!create) return updateExistingAccess(account);
  const admin = createAdminClient();
  const actorProfile = await admin.from("profiles").select("user_type,workspace_mode").eq("id", actor.id).single();
  if (actorProfile.error || actorProfile.data?.workspace_mode === "demo" || (actorProfile.data?.user_type !== "administrator" && account.userType === "Administrador")) return NextResponse.json({ error: "Alta no autorizada." }, { status: 403 });
  if (actorProfile.data?.user_type !== "administrator") {
    const db = await createClient();
    const requested = Object.entries(account.specificPermissions ?? {}).filter(([, allowed]) => allowed);
    for (const [key] of requested) {
      if (!editableSpecificPermissionKeys.includes(key as SpecificPermissionKey)) return NextResponse.json({ error: "Permiso no válido." }, { status: 400 });
      const check = await db.rpc("has_permission", { requested_permission: key });
      if (check.error || check.data !== true) return NextResponse.json({ error: "No puedes delegar permisos que no tienes." }, { status: 403 });
    }
    for (const action of account.moduleActionPermissions ?? []) {
      const check = await db.rpc("has_module_permission", { requested_module_id: action.moduleId, requested_action: action.action });
      if (check.error || check.data !== true) return NextResponse.json({ error: "No puedes delegar módulos fuera de tu alcance." }, { status: 403 });
    }
    for (const process of account.documentAccess ?? []) {
      const check = await db.rpc("has_process_document_role", { requested_process_id: process.processId, required_role: process.role });
      if (check.error || check.data !== true) return NextResponse.json({ error: "No puedes delegar procesos fuera de tu alcance." }, { status: 403 });
    }
  }
  const external = account.userType === "Cliente" || account.userType === "Proveedor";
  if (external && !isUuid(account.companyId)) {
    return NextResponse.json(
      { error: "Empresa no registrada. La empresa seleccionada todavía no está registrada en IntegraQ.", code: "COMPANY_NOT_REGISTERED" },
      { status: 400 },
    );
  }
  if (external) {
    const expectedKind = account.userType === "Cliente" ? "customer" : "supplier";
    const companyResult = await admin.from("organizations").select("id,name,kind,active").eq("id", account.companyId).maybeSingle();
    if (companyResult.error) throw companyResult.error;
    if (!companyResult.data || companyResult.data.kind !== expectedKind || !companyResult.data.active) {
      return NextResponse.json(
        { error: "Empresa no registrada. La empresa seleccionada todavía no está registrada en IntegraQ.", code: "COMPANY_NOT_REGISTERED" },
        { status: 400 },
      );
    }
    account.companyName = companyResult.data.name;
    if (account.siteId) {
      const siteResult = await admin.from("external_company_sites").select("id,code,name,active").eq("id", account.siteId).eq("company_id", account.companyId).maybeSingle();
      if (siteResult.error) throw siteResult.error;
      if (!siteResult.data || !siteResult.data.active) {
        return NextResponse.json({ error: "La sucursal seleccionada no pertenece a la empresa o está inactiva." }, { status: 400 });
      }
      account.siteCode = siteResult.data.code;
      account.siteName = siteResult.data.name;
    }
  }
  let userId = account.authUserId;
  if (create) {
    const siteUrl = getPublicSiteUrl(request);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(
      account.email.trim().toLocaleLowerCase("es-MX"),
      {
        data: { full_name: account.fullName.trim() },
        redirectTo: `${siteUrl}/update-password`,
      },
    );
    if (error || !data.user) {
      return NextResponse.json({ error: error?.message ?? "No fue posible invitar al usuario." }, { status: 400 });
    }
    userId = data.user.id;
  }
  if (!userId) {
    return NextResponse.json({ error: "Usuario de autenticación inválido." }, { status: 400 });
  }

  const databaseUserType = userTypeToDatabase[account.userType];
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    email: account.email.trim().toLocaleLowerCase("es-MX"),
    user_metadata: { full_name: account.fullName.trim() },
    app_metadata: { user_type: databaseUserType },
  });
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const { data: position } = account.positionId
    ? await admin.from("positions").select("name,branch,organization_id").eq("id", account.positionId).maybeSingle()
    : { data: null };
  const names = account.fullName.trim().split(/\s+/).filter(Boolean);
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: account.fullName.trim(),
      short_name: names.length > 1 ? `${names[0]} ${names[1][0]}.` : names[0],
      initials: names.slice(0, 2).map((name) => name[0]).join("").toLocaleUpperCase("es-MX"),
      organization_id: external ? null : position?.organization_id ?? null,
      position_id: external ? null : account.positionId ?? null,
      position_name: external ? null : position?.name ?? account.positionName ?? null,
      department: external ? null : position?.branch ?? account.branch ?? null,
      company: external ? account.companyName ?? null : "Towell",
      user_type: databaseUserType,
      status: account.status,
      continuous_improvement_role:
        databaseUserType === "administrator"
          ? "manager"
          : databaseUserType === "internal"
            ? account.continuousImprovementRole ?? "submitter"
            : null,
      external_party_kind:
        account.userType === "Cliente"
          ? "customer"
          : account.userType === "Proveedor"
            ? "supplier"
            : null,
      external_party_id: external ? account.companyId : null,
      external_party_name: external ? account.companyName ?? null : null,
      external_site_id: external ? account.siteId ?? null : null,
      site: external ? account.siteName ?? null : null,
    })
    .eq("id", userId);
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  if (account.userType === "Usuario interno") {
    const normalizedActions = normalizeModulePermissions(
      account.moduleActionPermissions,
    );
    const visibleModules = new Set<WorkspaceModuleId>([
      "home",
      ...account.assignedModuleIds,
      ...normalizedActions.map((permission) => permission.moduleId),
    ]);
    const deletes = await Promise.all([
      admin.from("user_process_permissions").delete().eq("user_id", userId),
      admin.from("user_module_permissions").delete().eq("user_id", userId),
      admin.from("user_module_action_permissions").delete().eq("user_id", userId),
    ]);
    const deleteError = deletes.find((result) => result.error)?.error;
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    const inserts = await Promise.all([
      account.documentAccess.length
        ? admin.from("user_process_permissions").insert(
            account.documentAccess.map((permission) => ({
              user_id: userId,
              process_id: permission.processId,
              document_role: permission.role,
              source: "direct",
              inherited_from_position_id: null,
            })),
          )
        : Promise.resolve({ error: null }),
      visibleModules.size
        ? admin.from("user_module_permissions").insert(
            [...visibleModules].map((moduleId) => ({
              user_id: userId,
              module_id: moduleId,
              can_view: true,
              can_manage: normalizedActions.some(
                (permission) =>
                  permission.moduleId === moduleId &&
                  permission.action === "manage",
              ),
              source: "direct",
              inherited_from_position_id: null,
            })),
          )
        : Promise.resolve({ error: null }),
      normalizedActions.length
        ? admin.from("user_module_action_permissions").insert(
            normalizedActions.map((permission) => ({
              user_id: userId,
              module_id: permission.moduleId,
              action: permission.action,
              source: "direct",
              inherited_from_position_id: null,
            })),
          )
        : Promise.resolve({ error: null }),
    ]);
    const insertError = inserts.find((result) => result.error)?.error;
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }
  }

  {
    const { data: permissionRows, error: permissionError } = await admin
      .from("permissions")
      .select("id,code")
      .in("code", editableSpecificPermissionKeys);
    if (permissionError) {
      return NextResponse.json({ error: permissionError.message }, { status: 400 });
    }
    if (permissionRows?.length) {
      const { error: overrideError } = await admin
        .from("user_permission_overrides")
        .upsert(permissionRows.map((permission) => ({
          user_id: userId,
          permission_id: permission.id,
          allowed: account.userType === "Administrador"
            ? true
            : Boolean(account.specificPermissions?.[permission.code as SpecificPermissionKey]),
          granted_by: actor.id,
        })), { onConflict: "user_id,permission_id" });
      if (overrideError) {
        return NextResponse.json({ error: overrideError.message }, { status: 400 });
      }
    }
  }

  await admin.from("audit_log").insert({
    actor_id: actor.id,
    action: create ? "user.created" : "user.access_updated",
    resource_type: "profile",
    resource_id: userId,
    metadata: {
      user_type: databaseUserType,
      process_count: account.documentAccess.length,
      module_action_count: account.moduleActionPermissions.length,
      specific_permissions: account.specificPermissions ?? {},
      external_company_id: external ? account.companyId : null,
      external_site_id: external ? account.siteId ?? null : null,
    },
  });

  return NextResponse.json({
    ok: true,
    userId,
    message: create
      ? `Invitación enviada a ${account.email.trim().toLocaleLowerCase("es-MX")}.`
      : "Usuario actualizado.",
  });
}

function getPublicSiteUrl(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  if (forwardedHost) return `${forwardedProtocol ?? "https"}://${forwardedHost}`;

  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured && /^https?:\/\//i.test(configured)) return configured;

  const host = request.headers.get("host");
  if (host) return `${forwardedProtocol ?? (host.includes("localhost") ? "http" : "https")}://${host}`;

  return new URL(request.url).origin;
}

function isUuid(value: string | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

async function updateExistingAccess(account: UserAccessAccount) {
  if (!isUuid(account.authUserId) || !account.accessRevision || !Array.isArray(account.documentAccess) || !Array.isArray(account.moduleActionPermissions) || !Array.isArray(account.assignedModuleIds)) return NextResponse.json({ error: "Recarga los permisos actuales antes de guardar." }, { status: 400 });
  const supabase = await createClient();
  const result = await supabase.rpc("save_user_access", { requested_user_id: account.authUserId, expected_revision: account.accessRevision, requested_account: { ...account, specificPermissions: account.specificPermissions ?? {} } });
  if (result.error) {
    const stale = result.error.message.includes("ACCESS_STALE");
    const missing = result.error.code === "PGRST202" || result.error.code === "42883";
    return NextResponse.json({ error: stale ? "Los permisos cambiaron. Recarga el usuario antes de editar." : missing ? "El servicio de permisos no está disponible. No se guardaron cambios." : "No se guardaron los cambios de acceso. Revisa autorización y datos." }, { status: stale ? 409 : missing ? 503 : 403 });
  }
  return NextResponse.json({ ok: true, userId: account.authUserId, message: "Permisos actualizados y auditados. El correo de autenticación se conserva." });
}
