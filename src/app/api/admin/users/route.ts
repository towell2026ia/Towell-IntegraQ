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
  isReopeningPermission,
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
    .select("user_type,status,organization_id,workspace_mode")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profile?.status !== "active" || profile.workspace_mode !== "production" || !["internal","administrator"].includes(profile.user_type)) return null;
  if (profile.user_type === "administrator") return {id:userData.user.id,global:true,org:profile.organization_id};
  const { data: allowed } = await supabase.rpc("has_permission", {
    requested_permission: permission,
  });
  return allowed ? {id:userData.user.id,global:false,org:profile.organization_id} : null;
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
  const profileQuery = admin.from("profiles").select("id,external_id,full_name,position_id,position_name,department,company,user_type,status,continuous_improvement_role,external_party_id,external_party_name,external_site_id,created_at,updated_at").order("full_name");
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
    actor.global ? profileQuery : profileQuery.eq("organization_id",actor.org).eq("user_type","internal"),
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
    const specificPermissions = Object.fromEntries((permissionOverridesResult.data ?? []).flatMap(row => {
      const permission = Array.isArray(row.permission) ? row.permission[0] : row.permission;
      return row.user_id === profile.id && permission && editableSpecificPermissionKeys.includes(permission.code as SpecificPermissionKey)
        ? [[permission.code,row.allowed]] : [];
    }));

    return {
      ...(() => {
        const site = profile.external_site_id ? externalSites.get(profile.external_site_id) : undefined;
        return { siteId: site?.id, siteCode: site?.code, siteName: site?.name };
      })(),
      id: profile.external_id,
      authUserId: profile.id,
      revision: profile.updated_at,
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
      specificPermissions,
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
  const admin = createAdminClient();
  if (!actor.global) return NextResponse.json({error:"La configuración integral de una cuenta requiere administración global."},{status:403});
  if (account.authUserId === actor.id) return NextResponse.json({error:"No puedes cambiar tus propias autorizaciones."},{status:403});
  if (!create && !account.revision) return NextResponse.json({error:"Recarga la cuenta para editar su versión vigente."},{status:409});
  if (Object.keys(account.specificPermissions ?? {}).some(code => !editableSpecificPermissionKeys.includes(code as SpecificPermissionKey))) return NextResponse.json({error:"Permiso fuera del catálogo."},{status:400});
  const inherited = account.inheritPermissions ?? [];
  if (!Array.isArray(inherited) || inherited.some(key => !isReopeningPermission(key) || account.specificPermissions?.[key] !== undefined)
      || Object.values(account.specificPermissions ?? {}).some(value => typeof value !== "boolean")) {
    return NextResponse.json({error:"Configuración de permisos no válida."},{status:400});
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
  const databaseUserType = userTypeToDatabase[account.userType];
  const { data: position, error: positionError } = account.positionId
    ? await admin.from("positions").select("name,branch,organization_id").eq("id", account.positionId).maybeSingle()
    : { data: null, error: null };
  if (!external && (!position?.organization_id || positionError)) return NextResponse.json({error:"El puesto no tiene organización vigente."},{status:400});
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

  const identity = await admin.auth.admin.getUserById(userId);
  if (identity.error || !identity.data.user) return NextResponse.json({error:"Cuenta de autenticación no disponible."},{status:409});
  // Permission-only saves do not touch Auth or replace the active session.
  const emailChanged = identity.data.user.email?.toLowerCase() !== account.email.trim().toLowerCase();
  const names = account.fullName.trim().split(/\s+/).filter(Boolean);
  const profile = {
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
  };
  const internal = databaseUserType === "internal";
  const actions = internal ? normalizeModulePermissions(account.moduleActionPermissions) : [];
  const modules = internal ? [...new Set(["home",...account.assignedModuleIds,...actions.map(item => item.moduleId)])] : [];
  const preserveModules = !create && account.preserveModuleAssignments === true;
  const result = await admin.rpc("iq_save_account_permissions",{
    p_actor:actor.id,p_user:userId,p_revision:account.revision ?? null,p_profile:profile,
    p_processes:internal ? account.documentAccess : [],p_modules:preserveModules ? null : modules,p_actions:preserveModules ? null : actions,
    p_specific:{...account.specificPermissions,...Object.fromEntries(inherited.map(key => [key,null]))},p_create:create,
  });
  if (result.error || !result.data) {
    const conflict = result.error?.code === "40001";
    return NextResponse.json({error: conflict ? "La cuenta cambió. Recarga antes de guardar." : "No se pudieron confirmar los permisos."},{status:conflict ? 409 : 400});
  }
  const nameChanged = identity.data.user.user_metadata?.full_name !== account.fullName.trim();
  const typeChanged = identity.data.user.app_metadata?.user_type !== databaseUserType;
  if (emailChanged || nameChanged || typeChanged) {
    const changed = await admin.auth.admin.updateUserById(userId,{
      ...(emailChanged && {email:account.email.trim().toLowerCase()}),
      ...(nameChanged && {user_metadata:{full_name:account.fullName.trim()}}),
      ...(typeChanged && {app_metadata:{user_type:databaseUserType}}),
    });
    if (changed.error) return NextResponse.json({error:"Los permisos se guardaron. La identidad de acceso requiere sincronización. Recarga la cuenta."},{status:409});
  }

  return NextResponse.json({
    ok: true,
    userId,
    revision: result.data,
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
