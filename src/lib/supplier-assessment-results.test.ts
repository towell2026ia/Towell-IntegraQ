import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/202610080006_supplier_assessment_results.sql"), "utf8").toLocaleLowerCase();
const route = readFileSync(join(process.cwd(), "src/app/api/suppliers/assessments/route.ts"), "utf8");
const fileRoute = readFileSync(join(process.cwd(), "src/app/api/suppliers/assessments/[assessmentId]/file/route.ts"), "utf8");
const moduleSource = readFileSync(join(process.cwd(), "src/components/modules/suppliers-module.tsx"), "utf8");
const portalSource = readFileSync(join(process.cwd(), "src/components/modules/stakeholder-portal-module.tsx"), "utf8");
const dashboardRoute = readFileSync(join(process.cwd(), "src/app/api/suppliers/dashboard/route.ts"), "utf8");

describe("supplier assessment results contract", () => {
  it("stores a structured result separately from its source document", () => {
    expect(migration).toContain("create table public.supplier_assessments");
    for (const field of ["supplier_id", "site_id", "assessment_type", "assessment_date", "evaluator_name", "score", "classification", "observations", "source_file_id"]) expect(migration).toContain(field);
    expect(migration).toContain("supplier_assessment_source");
  });

  it("accepts only spreadsheet source formats without automatic extraction", () => {
    for (const mime of ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"]) expect(migration).toContain(mime);
    expect(route).toContain("Formato no permitido. Usa XLSX, XLS o CSV.");
    expect(route).not.toMatch(/extract.*score|parse.*excel|openai/i);
  });

  it("requires supplier update permission for writes", () => {
    expect(route).toContain('canPerformModuleAction(session, "suppliers", "update")');
    expect(migration).toContain("public.has_module_permission('suppliers', 'update')");
    expect(migration).not.toContain("for delete");
  });

  it("restricts provider visibility by company, site and explicit publication", () => {
    expect(migration).toContain("assessment.portal_visible");
    expect(migration).toContain("has_external_organization_scope('supplier', assessment.supplier_id)");
    expect(migration).toContain("has_external_site_scope(assessment.site_id)");
    expect(route).toContain('.eq("portal_visible", true)');
    expect(portalSource).toContain("Auditorías y evaluaciones autorizadas");
  });

  it("keeps files private and serves short-lived signed URLs", () => {
    expect(route).toContain('const privateBucket = "integraq-private"');
    expect(migration).toContain("supplier_assessment_file_immutable");
    expect(migration).toContain("supplier_assessment_source_invalid");
    expect(fileRoute).toContain("createSignedUrl(file.data.object_path, 120,");
    expect(fileRoute).toContain("download: file.data.original_name");
    expect(fileRoute).not.toContain("getPublicUrl");
  });

  it("surfaces new records in the supplier history and production UI", () => {
    expect(dashboardRoute).toContain('from("supplier_assessments")');
    expect(dashboardRoute).toContain("scopedAssessments");
    expect(moduleSource).toContain("El resultado capturado es la fuente maestra");
    expect(moduleSource).toContain('accept=".xlsx,.xls,.csv"');
    expect(moduleSource).toContain("Vista previa");
    expect(moduleSource).toContain("Descargar");
  });
});
