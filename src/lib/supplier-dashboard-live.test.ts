import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { emptySupplierDashboardFilters, supplierDashboardQuery } from "@/lib/supplier-dashboard-data";

const api = readFileSync(join(process.cwd(), "src/app/api/suppliers/dashboard/route.ts"), "utf8");
const moduleSource = readFileSync(join(process.cwd(), "src/components/modules/suppliers-module.tsx"), "utf8");
const migration = readFileSync(join(process.cwd(), "supabase/migrations/202610080005_supplier_dashboard_indexes.sql"), "utf8").toLocaleLowerCase();

describe("supplier live dashboard contract", () => {
  it("builds metrics and history from live records", () => {
    for (const table of ["supplier_rncp_reports", "supplier_rncp_actions", "audits", "supplier_quality_evaluations", "audit_log"]) {
      expect(api).toContain(`from(\"${table}\")`);
    }
    expect(api).toContain('.is("deleted_at", null)');
    expect(api).not.toContain("rncpDashboardSummary");
  });

  it("applies all requested filters through the same query", () => {
    const query = supplierDashboardQuery({ ...emptySupplierDashboardFilters, search: "Anáhuac", supplierId: "supplier-1", siteId: "site-1", status: "in_progress", dateFrom: "2026-01-01", dateTo: "2026-10-08", category: "Crítico", lateOnly: true, pendingActionsOnly: true });
    for (const key of ["search", "supplierId", "siteId", "status", "dateFrom", "dateTo", "category", "lateOnly", "pendingActionsOnly"]) expect(query).toContain(`${key}=`);
    expect(moduleSource).toContain("Limpiar");
  });

  it("exports CSV and XLSX only for administrators and preserves filters", () => {
    expect(api).toContain('format === "csv" || format === "xlsx"');
    expect(api).toContain("isAdministrator(session)");
    expect(moduleSource).toContain('exportSupplierDashboard(dashboard.filters, "csv")');
    expect(moduleSource).toContain('exportSupplierDashboard(dashboard.filters, "xlsx")');
  });

  it("uses Mexico City for the derived late status and orders history newest first", () => {
    expect(api).toContain('timeZone: "America/Mexico_City"');
    expect(api).toContain("right.occurredAt.localeCompare(left.occurredAt)");
  });

  it("adds indexes without replacing or deleting historical records", () => {
    expect(migration).toContain("supplier_rncp_dashboard_filter_idx");
    expect(migration).toContain("supplier_audits_dashboard_idx");
    expect(migration).toContain("supplier_evaluations_dashboard_idx");
    expect(migration).not.toContain("delete from");
    expect(migration).not.toContain("truncate");
  });
});
