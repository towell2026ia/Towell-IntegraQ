import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/202610080002_external_company_master.sql"), "utf8").toLocaleLowerCase();
const usersRoute = readFileSync(join(process.cwd(), "src/app/api/admin/users/route.ts"), "utf8");
const companiesRoute = readFileSync(join(process.cwd(), "src/app/api/admin/external-companies/route.ts"), "utf8");
const accessModule = readFileSync(join(process.cwd(), "src/components/modules/access-module.tsx"), "utf8");

const supplierEvaluationTable = "public.supplier_quality_evaluations";
const legacyUniqueColumns = ["supplier_id", "period_start", "period_end"];

type UniqueConstraintCandidate = {
  columns: string[];
  name: string;
  table: string;
  type: "p" | "u";
};

function resolveLegacySupplierEvaluationConstraint(candidates: UniqueConstraintCandidate[]) {
  const matches = candidates.filter(
    (candidate) =>
      candidate.table === supplierEvaluationTable &&
      candidate.type === "u" &&
      candidate.columns.length === legacyUniqueColumns.length &&
      candidate.columns.every((column, index) => column === legacyUniqueColumns[index]),
  );

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one legacy supplier evaluation UNIQUE constraint; found ${matches.length}`);
  }

  return matches[0].name;
}

function legacyCandidate(name: string, columns = legacyUniqueColumns): UniqueConstraintCandidate {
  return {
    columns,
    name,
    table: supplierEvaluationTable,
    type: "u",
  };
}

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

  it.each([
    "supplier_quality_evaluations_supplier_id_period_start_period_end_key",
    "supplier_quality_evaluations_supplier_id_period_start_perio_key",
    "uq_supplier_eval_period",
  ])("resolves the legacy UNIQUE constraint independently of its name: %s", (constraintName) => {
    expect(resolveLegacySupplierEvaluationConstraint([legacyCandidate(constraintName)])).toBe(constraintName);
  });

  it("aborts when no equivalent legacy UNIQUE constraint exists", () => {
    expect(() => resolveLegacySupplierEvaluationConstraint([])).toThrow(
      "Expected exactly one legacy supplier evaluation UNIQUE constraint; found 0",
    );
  });

  it("aborts when more than one equivalent legacy UNIQUE constraint exists", () => {
    expect(() =>
      resolveLegacySupplierEvaluationConstraint([
        legacyCandidate("legacy_unique_one"),
        legacyCandidate("legacy_unique_two"),
      ]),
    ).toThrow("Expected exactly one legacy supplier evaluation UNIQUE constraint; found 2");
  });

  it.each([
    ["a similar constraint", ["supplier_id", "period_start"]],
    ["a constraint with different column order", ["period_start", "supplier_id", "period_end"]],
  ])("does not treat %s as equivalent", (_caseName, columns) => {
    expect(() => resolveLegacySupplierEvaluationConstraint([legacyCandidate("not_equivalent", columns)])).toThrow(
      "Expected exactly one legacy supplier evaluation UNIQUE constraint; found 0",
    );
  });

  it("uses structured catalog lookup and guarded identifier-safe constraint removal", () => {
    expect(migration).toContain("from pg_constraint constraint_record");
    expect(migration).toContain("unnest(constraint_record.conkey)");
    expect(migration).toContain("with ordinality as key_column(attnum, ordinality)");
    expect(migration).toContain("join pg_attribute attribute_record");
    expect(migration).toContain("constraint_record.contype = 'u'");
    expect(migration).toContain("'public.supplier_quality_evaluations'::regclass");
    expect(migration).toContain("array['supplier_id', 'period_start', 'period_end']::text[]");
    expect(migration).toContain("if legacy_constraint_count <> 1 then");
    expect(migration).toContain("drop constraint %i");
    expect(migration).toContain("legacy_constraint_name");
    expect(migration).not.toContain("drop constraint if exists");
    expect(migration).not.toContain("drop constraint supplier_quality_evaluations_supplier_id_period_start_period_end_key");
    expect(migration).not.toContain("drop constraint supplier_quality_evaluations_supplier_id_period_start_perio_key");
  });

  it("creates the site-aware NULLS NOT DISTINCT uniqueness model", () => {
    expect(migration).toContain("add column site_id uuid references public.external_company_sites(id) on delete restrict");
    expect(migration).toContain("create unique index supplier_quality_evaluations_scope_period_uidx");
    expect(migration).toContain(
      "on public.supplier_quality_evaluations(supplier_id, site_id, period_start, period_end)",
    );
    expect(migration).toContain("nulls not distinct");
  });
});
