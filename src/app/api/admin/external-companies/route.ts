import { NextResponse } from "next/server";

import { validateExternalCompanyDeactivation, type ExternalCompany, type ExternalCompanySite } from "@/lib/external-company-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

type Actor = {
  id: string;
  userType: "administrator" | "internal" | "customer" | "supplier";
  organizationId: string | null;
  externalPartyId: string | null;
  externalSiteId: string | null;
  readableKinds: Array<"customer" | "supplier">;
};

type CompanyRow = {
  id: string;
  code: string;
  name: string;
  kind: "customer" | "supplier";
  active: boolean;
  created_at: string;
  updated_at: string;
  owning_organization_id?: string | null;
  legal_name?: string | null;
  tax_id?: string | null;
  address?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
};

type SiteRow = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  address: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

async function getActor(): Promise<Actor | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const profile = await supabase.from("profiles").select("user_type,status,organization_id,external_party_id,external_site_id").eq("id", data.user.id).maybeSingle();
  if (!profile.data || profile.data.status !== "active") return null;
  const userType = profile.data.user_type as Actor["userType"];
  let readableKinds: Actor["readableKinds"] = [];
  if (userType === "administrator") readableKinds = ["customer", "supplier"];
  else if (userType === "customer" || userType === "supplier") readableKinds = [userType];
  else {
    const [customers, suppliers] = await Promise.all([
      supabase.rpc("has_module_permission", { requested_module_id: "customers", requested_action: "view" }),
      supabase.rpc("has_module_permission", { requested_module_id: "suppliers", requested_action: "view" }),
    ]);
    if (customers.data === true) readableKinds.push("customer");
    if (suppliers.data === true) readableKinds.push("supplier");
  }
  return {
    id: data.user.id,
    userType,
    organizationId: profile.data.organization_id,
    externalPartyId: profile.data.external_party_id,
    externalSiteId: profile.data.external_site_id,
    readableKinds,
  };
}

async function listCompanies(actor: Actor) {
  if (!actor.readableKinds.length) return [];
  const admin = createAdminClient();
  let companyQuery = admin.from("organizations").select("id,code,name,kind,active,created_at,updated_at,owning_organization_id,legal_name,tax_id,address,contact_name,contact_email").in("kind", actor.readableKinds).order("name");
  if (actor.userType === "customer" || actor.userType === "supplier") {
    if (!actor.externalPartyId) return [];
    companyQuery = companyQuery.eq("id", actor.externalPartyId);
  } else {
    if (!actor.organizationId) return [];
    if (!await isActiveInternalOrganization(admin, actor.organizationId)) return [];
    companyQuery = companyQuery.eq("owning_organization_id", actor.organizationId);
  }
  const companiesResult = await companyQuery;
  if (companiesResult.error) throw companiesResult.error;
  const externalActor = actor.userType === "customer" || actor.userType === "supplier";
  const companies = (companiesResult.data ?? []) as CompanyRow[];
  const ids = companies.map(company => company.id);
  let sitesQuery = admin
    .from("external_company_sites")
    .select("id,company_id,code,name,address,active,created_at,updated_at")
    .in("company_id", ids)
    .order("name");
  if (externalActor && actor.externalSiteId) sitesQuery = sitesQuery.eq("id", actor.externalSiteId);
  const [sitesResult, profilesResult] = await Promise.all([
    ids.length ? sitesQuery : Promise.resolve({ data: [], error: null }),
    ids.length
      ? admin.from("supplier_quality_profiles").select("organization_id,category").in("organization_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sitesResult.error) throw sitesResult.error;
  if (profilesResult.error) throw profilesResult.error;
  const categories = new Map((profilesResult.data ?? []).map((profile) => [profile.organization_id, profile.category ?? undefined]));
  const sites = (sitesResult.data ?? []) as SiteRow[];
  return companies.map((company) => mapCompany(company, sites.filter((site) => site.company_id === company.id), categories.get(company.id)));
}

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
    return NextResponse.json({ companies: await listCompanies(actor) });
  } catch (error) {
    console.error("No fue posible consultar el maestro de empresas externas.", error);
    if (hasCode(error, "42703")) return ownershipMigrationRequired();
    return NextResponse.json({ error: "No fue posible consultar las empresas externas." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return mutate(request, true);
}

export async function PATCH(request: Request) {
  return mutate(request, false);
}

async function mutate(request: Request, create: boolean) {
  try {
    const actor = await getActor();
    if (!actor || actor.userType !== "administrator") {
      return NextResponse.json({ error: "Sólo un administrador puede modificar empresas externas." }, { status: 403 });
    }
    if (!actor.organizationId) return NextResponse.json({ error: "La cuenta administrativa no tiene una organización titular verificada." }, { status: 403 });
    const admin = createAdminClient();
    if (!await isActiveInternalOrganization(admin, actor.organizationId)) {
      return NextResponse.json({ error: "La organización titular no existe, está inactiva o no es interna." }, { status: 403 });
    }
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || (payload.entity !== "company" && payload.entity !== "site")) {
      return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
    }
    const result = payload.entity === "company"
      ? await mutateCompany(payload, actor, create, admin)
      : await mutateSite(payload, actor, create, admin);
    if (result instanceof NextResponse) return result;
    return NextResponse.json({ ...result, companies: await listCompanies(actor) });
  } catch (error) {
    console.error("No fue posible actualizar el maestro de empresas externas.", error);
    if (hasCode(error, "42703")) return ownershipMigrationRequired();
    return NextResponse.json({ error: "No fue posible guardar la empresa o sucursal." }, { status: 500 });
  }
}

async function mutateCompany(payload: Record<string, unknown>, actor: Actor, create: boolean, admin = createAdminClient()) {
  const code = clean(payload.code).toLocaleUpperCase("es-MX");
  const name = clean(payload.name);
  const kind = payload.kind === "customer" || payload.kind === "supplier" ? payload.kind : null;
  if (!code || !name || !kind) return NextResponse.json({ error: "Código, nombre y tipo de empresa son obligatorios." }, { status: 400 });
  const reason = clean(payload.reason);
  if (!create && !validateExternalCompanyDeactivation(payload.active === false ? false : true, reason)) {
    return NextResponse.json({ error: "Indica el motivo para desactivar la empresa." }, { status: 400 });
  }
  if (!create && !isUuid(payload.id)) return companyError("INVALID_ID");
  let existingOwner: string | null = null;
  if (!create) {
    const existing = await admin.from("organizations").select("id,kind,owning_organization_id,legal_name,tax_id,address,contact_name,contact_email")
      .eq("id", payload.id).in("kind", ["customer", "supplier"]).maybeSingle();
    if (existing.error?.code === "42703") return ownershipMigrationRequired();
    if (existing.error) throw existing.error;
    if (!existing.data) return NextResponse.json({ error: "La empresa no existe." }, { status: 404 });
    existingOwner = existing.data.owning_organization_id ?? null;
    if (!existingOwner) return NextResponse.json({ error: "La titularidad histórica no está verificada; no se puede modificar ni desactivar." }, { status: 409 });
    if (existingOwner !== actor.organizationId) return NextResponse.json({ error: "La empresa pertenece a otra organización." }, { status: 403 });
    if (existing.data.kind !== kind) return NextResponse.json({ error: "No se puede cambiar el tipo de empresa." }, { status: 409 });
  }
  const deactivating = !create && payload.active === false;
  const values = {
    code, name, kind, active: payload.active !== false,
    ...(create ? { owning_organization_id: actor.organizationId } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "legalName") ? { legal_name: clean(payload.legalName) || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "taxId") ? { tax_id: clean(payload.taxId) || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "address") ? { address: clean(payload.address) || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "contactName") ? { contact_name: clean(payload.contactName) || null } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "contactEmail") ? { contact_email: clean(payload.contactEmail).toLocaleLowerCase("es-MX") || null } : {}),
    ...(deactivating ? { deleted_at: new Date().toISOString(), deleted_by: actor.id, deletion_reason: reason } : {}),
  };
  const saved = create
    ? await admin.from("organizations").insert(values).select("id,code,name,kind,active,created_at,updated_at,owning_organization_id,legal_name,tax_id,address,contact_name,contact_email").single()
    : await admin.from("organizations").update(values).eq("id", payload.id).eq("owning_organization_id", actor.organizationId)
      .in("kind", ["customer", "supplier"]).select("id,code,name,kind,active,created_at,updated_at,owning_organization_id,legal_name,tax_id,address,contact_name,contact_email").single();
  if (saved.error?.code === "42703") return ownershipMigrationRequired();
  if (saved.error || !saved.data) return companyError(saved.error?.message);
  if (kind === "supplier") {
    const profile = await admin.from("supplier_quality_profiles").upsert({ organization_id: saved.data.id, category: clean(payload.category) || null, active: payload.active !== false, updated_by: actor.id }, { onConflict: "organization_id" });
    if (profile.error) throw profile.error;
  }
  await writeAudit(actor.id, create ? "external_company.created" : payload.active === false ? "external_company.deactivated" : "external_company.updated", saved.data.id, payload.active === false ? { ...values, reason } : values);
  return { company: mapCompany(saved.data as CompanyRow, [], clean(payload.category) || undefined) };
}

async function mutateSite(payload: Record<string, unknown>, actor: Actor, create: boolean, admin = createAdminClient()) {
  const companyId = clean(payload.companyId);
  const code = clean(payload.code).toLocaleUpperCase("es-MX");
  const name = clean(payload.name);
  if (!isUuid(companyId) || !code || !name) return NextResponse.json({ error: "Empresa, código y nombre de sucursal son obligatorios." }, { status: 400 });
  const company = await admin.from("organizations").select("id,owning_organization_id").eq("id", companyId).in("kind", ["customer", "supplier"]).maybeSingle();
  if (company.error?.code === "42703") return ownershipMigrationRequired();
  if (company.error) throw company.error;
  if (!company.data) return NextResponse.json({ error: "Empresa no registrada. La empresa seleccionada todavía no está registrada en IntegraQ." }, { status: 400 });
  if (!company.data.owning_organization_id) return NextResponse.json({ error: "La titularidad histórica no está verificada; no se puede modificar la sucursal." }, { status: 409 });
  if (company.data.owning_organization_id !== actor.organizationId) return NextResponse.json({ error: "La empresa pertenece a otra organización." }, { status: 403 });
  const values = { company_id: companyId, code, name, address: clean(payload.address) || null, active: payload.active !== false };
  const saved = create
    ? await admin.from("external_company_sites").insert(values).select("id,company_id,code,name,address,active,created_at,updated_at").single()
    : isUuid(payload.id)
      ? await admin.from("external_company_sites").update(values).eq("id", payload.id).eq("company_id", companyId).select("id,company_id,code,name,address,active,created_at,updated_at").single()
      : { data: null, error: new Error("INVALID_ID") };
  if (saved.error || !saved.data) return siteError(saved.error?.message);
  await writeAudit(actor.id, create ? "external_company_site.created" : "external_company_site.updated", saved.data.id, values);
  return { site: mapSite(saved.data as SiteRow) };
}

async function writeAudit(actorId: string, action: string, resourceId: string, value: object) {
  const admin = createAdminClient();
  const result = await admin.from("audit_log").insert({ actor_id: actorId, module: "access", action, resource_type: "external_company", resource_id: resourceId, new_value: value });
  if (result.error) throw result.error;
}

function mapCompany(company: CompanyRow, sites: SiteRow[], category?: string): ExternalCompany {
  return { id: company.id, code: company.code, name: company.name, kind: company.kind, active: company.active, category, legalName: company.legal_name ?? undefined, taxId: company.tax_id ?? undefined, address: company.address ?? undefined, contactName: company.contact_name ?? undefined, contactEmail: company.contact_email ?? undefined, sites: sites.map(mapSite), createdAt: company.created_at, updatedAt: company.updated_at };
}

function mapSite(site: SiteRow): ExternalCompanySite {
  return { id: site.id, companyId: site.company_id, code: site.code, name: site.name, address: site.address ?? undefined, active: site.active, createdAt: site.created_at, updatedAt: site.updated_at };
}

async function isActiveInternalOrganization(admin: ReturnType<typeof createAdminClient>, organizationId: string) {
  const result = await admin.from("organizations").select("id")
    .eq("id", organizationId).eq("kind", "internal").eq("active", true).maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data);
}

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function hasCode(error: unknown, code: string) { return Boolean(error && typeof error === "object" && "code" in error && error.code === code); }
function companyError(message?: string) { return NextResponse.json({ error: message?.includes("duplicate") ? "Ya existe una empresa con ese código." : "No fue posible guardar la empresa." }, { status: 400 }); }
function siteError(message?: string) { return NextResponse.json({ error: message?.includes("duplicate") ? "Ya existe una sucursal con ese código para la empresa." : "No fue posible guardar la sucursal." }, { status: 400 }); }
function ownershipMigrationRequired() { return NextResponse.json({ error: "El esquema de titularidad aún no está disponible. No se modificó ningún registro." }, { status: 503 }); }
