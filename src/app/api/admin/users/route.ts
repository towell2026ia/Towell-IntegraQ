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
import type { UserAccessAccount } from "@/lib/user-access-data";

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
  created_at: string;
};

async function requireAdministrator() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_type,status")
    .eq("id", userData.user.id)
    .maybeSingle();
  return profile?.user_type === "administrator" && profile.status === "active"
    ? userData.user
    : null;
}

export async function GET() {
  const actor = await requireAdministrator();
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
    authUsersResult,
  ] = await Promise.all([
    admin.from("profiles").select("id,external_id,full_name,position_id,position_name,department,company,user_type,status,continuous_improvement_role,external_party_id,external_party_name,created_at").order("full_name"),
    admin.from("positions").select("id,name,branch"),
    admin.from("user_process_permissions").select("user_id,process_id,document_role,inherited_from_position_id"),
    admin.from("user_module_permissions").select("user_id,module_id,can_view"),
    admin.from("user_module_action_permissions").select("user_id,module_id,action"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const firstError = [
    profilesResult.error,
    positionsResult.error,
    processPermissionsResult.error,
    modulePermissionsResult.error,
    moduleActionsResult.error,
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
      (moduleActionsResult.data ?? [])
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
      createdAt: profile.created_at,
    } satisfies UserAccessAccount;
  });

  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  return saveAccount(request, true);
}

export async function PATCH(request: Request) {
  return saveAccount(request, false);
}

async function saveAccount(request: Request, create: boolean) {
  const actor = await requireAdministrator();
  if (!actor) {
    return NextResponse.json({ error: "Acceso exclusivo para administrador." }, { status: 403 });
  }

  const account = (await request.json()) as UserAccessAccount;
  if (!account.fullName?.trim() || !account.email?.trim()) {
    return NextResponse.json({ error: "Nombre y correo son obligatorios." }, { status: 400 });
  }
  if (
    account.userType !== "Administrador" &&
    account.userType !== "Usuario interno" &&
    !isUuid(account.companyId)
  ) {
    return NextResponse.json(
      { error: "La empresa externa debe existir primero en el catálogo de Supabase." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  let userId = account.authUserId;
  if (create) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    const { data, error } = await admin.auth.admin.inviteUserByEmail(
      account.email.trim().toLocaleLowerCase("es-MX"),
      {
        data: { full_name: account.fullName.trim() },
        redirectTo: siteUrl ? `${siteUrl}/update-password` : undefined,
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
  const external = account.userType === "Cliente" || account.userType === "Proveedor";
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

  await admin.from("audit_log").insert({
    actor_id: actor.id,
    action: create ? "user.created" : "user.access_updated",
    resource_type: "profile",
    resource_id: userId,
    metadata: {
      user_type: databaseUserType,
      process_count: account.documentAccess.length,
      module_action_count: account.moduleActionPermissions.length,
    },
  });

  return NextResponse.json({ ok: true, userId });
}

function isUuid(value: string | undefined) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}
