import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/202610080002_external_company_master.sql"), "utf8").toLocaleLowerCase();
const usersRoute = readFileSync(join(process.cwd(), "src/app/api/admin/users/route.ts"), "utf8");
const companiesRoute = readFileSync(join(process.cwd(), "src/app/api/admin/external-companies/route.ts"), "utf8");
const accessModule = readFileSync(join(process.cwd(), "src/components/modules/access-module.tsx"), "utf8");

describe("external company master contract", () => {
  it("models companies and sites without deleting historical organizations", () => {
    expect(migration).toContain("create table public.external_company_sites");
    expect(migration).toContain("external_site_id uuid");
    expect(migration).toContain("('035-a', 'planta algodón anillo')");
    expect(migration).toContain("('035-oe', 'planta open end')");
    expect(migration).not.toContain("delete from public.organizations");
  });

  it("enforces company and optional site isolation in server policies", () => {
    expect(migration).toContain("has_external_organization_scope('supplier', report.supplier_id)");
    expect(migration).toContain("has_external_site_scope(report.site_id)");
    expect(migration).toContain("has_external_site_scope(audit.external_site_id)");
    expect(migration).toContain("external_site_company_mismatch");
    expect(migration).toContain("and organization.active");
    expect(migration).toContain("where site.id = profile.external_site_id and site.active");
    expect(companiesRoute).toContain('profile.data.external_site_id');
    expect(companiesRoute).toContain('sitesQuery.eq("id", actor.externalSiteId)');
    expect(companiesRoute).toContain('in("kind", actor.readableKinds)');
  });

  it("offers domain-facing company creation and site selection", () => {
    expect(usersRoute).toContain("Empresa no registrada");
    expect(usersRoute).toContain("external_site_id");
    expect(accessModule).toContain("Crear empresa");
    expect(accessModule).toContain("Sucursal (opcional)");
    expect(accessModule).not.toContain("Supabase");
    expect(usersRoute).not.toContain("catálogo de Supabase");
  });
});
