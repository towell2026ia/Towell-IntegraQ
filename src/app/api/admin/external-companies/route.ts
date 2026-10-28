import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { canAccessModule } from "@/lib/access-policy";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { NextResponse } from "next/server";

import type { ExternalCompany, ExternalCompanySite } from "@/lib/external-company-data";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

type Actor = {
  id: string;
  userType: "administrator" | "internal" | "customer" | "supplier";
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
  const session = await getAuthenticatedSession();
  if (!session?.authUserId || session.workspaceMode === "demo") return null;
  const userType = session.userType === "Administrador" ? "administrator" : session.userType === "Usuario interno" ? "internal" : session.userType === "Cliente" ? "customer" : "supplier";
  const readableKinds: Actor["readableKinds"] = [];
  if (userType === "administrator") readableKinds.push("customer", "supplier");
  else if (userType === "customer" || userType === "supplier") {
    if (!canAccessModule(session, userType === "customer" ? "customer-portal" : "supplier-portal")) return null;
    readableKinds.push(userType);
  } else {
    if (canPerformModuleAction(session, "access", "view") || canPerformModuleAction(session, "customers", "view")) readableKinds.push("customer");
    if (canPerformModuleAction(session, "access", "view") || canPerformModuleAction(session, "suppliers", "view")) readableKinds.push("supplier");
  }
  return { id: session.authUserId, userType, externalPartyId: session.externalParty?.companyId ?? null, externalSiteId: session.externalParty?.siteId ?? null, readableKinds };
}

async function listCompanies(actor: Actor) {
  if (!actor.readableKinds.length) return [];
  const admin = createAdminClient();
  let companyQuery = admin.from("organizations").select("id,code,name,kind,active,created_at,updated_at").in("kind", actor.readableKinds).order("name");
  if (actor.userType === "customer" || actor.userType === "supplier") {
    if (!actor.externalPartyId) return [];
    companyQuery = companyQuery.eq("id", actor.externalPartyId);
  }
  const companiesResult = await companyQuery;
  if (companiesResult.error) throw companiesResult.error;
  const ids = (companiesResult.data ?? []).map((company) => company.id);
  const externalActor = actor.userType === "customer" || actor.userType === "supplier";
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
  return ((companiesResult.data ?? []) as CompanyRow[]).map((company) => mapCompany(company, sites.filter((site) => site.company_id === company.id), categories.get(company.id)));
}

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
    return NextResponse.json({ companies: await listCompanies(actor) });
  } catch (error) {
    console.error("No fue posible consultar el maestro de empresas externas.", error);
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
    if (!actor || !["administrator", "internal"].includes(actor.userType)) {
      return NextResponse.json({ error: "Sólo un administrador puede modificar empresas externas." }, { status: 403 });
    }
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || (payload.entity !== "company" && payload.entity !== "site")) {
      return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
    }
    const result = payload.entity === "company"
      ? await mutateCompany(payload, actor, create)
      : await mutateSite(payload, actor, create);
    if (result instanceof NextResponse) return result;
    return NextResponse.json({ ...result, companies: await listCompanies(actor) });
  } catch (error) {
    console.error("No fue posible actualizar el maestro de empresas externas.", error);
    return NextResponse.json({ error: "No fue posible guardar la empresa o sucursal." }, { status: 500 });
  }
}

async function mutateCompany(payload: Record<string, unknown>, actor: Actor, create: boolean) {
  const code = clean(payload.code).toLocaleUpperCase("es-MX");
  const name = clean(payload.name);
  const kind = payload.kind === "customer" || payload.kind === "supplier" ? payload.kind : null;
  if (!code || !name || !kind) return NextResponse.json({ error: "Código, nombre y tipo de empresa son obligatorios." }, { status: 400 });
  const admin = createAdminClient();
  const session = await getAuthenticatedSession();
  if (!session || !canPerformModuleAction(session, kind === "customer" ? "customers" : "suppliers", "manage")) return NextResponse.json({ error: "Sin permiso para administrar esta empresa." }, { status: 403 });
  const values = { code, name, kind, active: payload.active !== false };
  const saved = create
    ? await admin.from("organizations").insert(values).select("id,code,name,kind,active,created_at,updated_at").single()
    : isUuid(payload.id)
      ? await admin.from("organizations").update(values).eq("id", payload.id).eq("kind", kind).select("id,code,name,kind,active,created_at,updated_at").single()
      : { data: null, error: new Error("INVALID_ID") };
  if (saved.error || !saved.data) return companyError(saved.error?.message);
  if (kind === "supplier") {
    const profile = await admin.from("supplier_quality_profiles").upsert({ organization_id: saved.data.id, category: clean(payload.category) || null, active: payload.active !== false, updated_by: actor.id }, { onConflict: "organization_id" });
    if (profile.error) throw profile.error;
  }
  await writeAudit(actor.id, create ? "external_company.created" : "external_company.updated", saved.data.id, values);
  return { company: mapCompany(saved.data as CompanyRow, [], clean(payload.category) || undefined) };
}

async function mutateSite(payload: Record<string, unknown>, actor: Actor, create: boolean) {
  const companyId = clean(payload.companyId);
  const code = clean(payload.code).toLocaleUpperCase("es-MX");
  const name = clean(payload.name);
  if (!isUuid(companyId) || !code || !name) return NextResponse.json({ error: "Empresa, código y nombre de sucursal son obligatorios." }, { status: 400 });
  const admin = createAdminClient();
  const company = await admin.from("organizations").select("id,kind").eq("id", companyId).in("kind", ["customer", "supplier"]).maybeSingle();
  if (company.error) throw company.error;
  if (!company.data) return NextResponse.json({ error: "Empresa no registrada. La empresa seleccionada todavía no está registrada en IntegraQ." }, { status: 400 });
  const session = await getAuthenticatedSession();
  if (!session || !canPerformModuleAction(session, company.data.kind === "customer" ? "customers" : "suppliers", "manage")) return NextResponse.json({ error: "Sin permiso para administrar esta empresa." }, { status: 403 });
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
  return { id: company.id, code: company.code, name: company.name, kind: company.kind, active: company.active, category, sites: sites.map(mapSite), createdAt: company.created_at, updatedAt: company.updated_at };
}

function mapSite(site: SiteRow): ExternalCompanySite {
  return { id: site.id, companyId: site.company_id, code: site.code, name: site.name, address: site.address ?? undefined, active: site.active, createdAt: site.created_at, updatedAt: site.updated_at };
}

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function companyError(message?: string) { return NextResponse.json({ error: message?.includes("duplicate") ? "Ya existe una empresa con ese código." : "No fue posible guardar la empresa." }, { status: 400 }); }
function siteError(message?: string) { return NextResponse.json({ error: message?.includes("duplicate") ? "Ya existe una sucursal con ese código para la empresa." : "No fue posible guardar la sucursal." }, { status: 400 }); }
