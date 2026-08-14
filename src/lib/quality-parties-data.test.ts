import { describe, expect, it } from "vitest";

import {
  customerQualityCatalog,
  rncpDashboardSummary,
  supplierQualityCatalog,
} from "@/lib/quality-parties-data";

describe("quality party configuration", () => {
  it("keeps customer and supplier identifiers unique", () => {
    expect(new Set(customerQualityCatalog.map((item) => item.id)).size).toBe(
      customerQualityCatalog.length,
    );
    expect(new Set(supplierQualityCatalog.map((item) => item.id)).size).toBe(
      supplierQualityCatalog.length,
    );
  });

  it("represents the identified supplier directory", () => {
    expect(supplierQualityCatalog).toHaveLength(62);
  });

  it("reconciles the RNCP status summary", () => {
    expect(
      rncpDashboardSummary.closed +
        rncpDashboardSummary.late +
        rncpDashboardSummary.inProcess,
    ).toBe(rncpDashboardSummary.total);
  });

  it("requires an effectiveness value for audit-exempt suppliers", () => {
    const exemptSuppliers = supplierQualityCatalog.filter(
      (supplier) => !supplier.auditRequired,
    );
    expect(exemptSuppliers.length).toBeGreaterThan(0);
    expect(
      exemptSuppliers.every((supplier) => supplier.effectiveness !== null),
    ).toBe(true);
  });
});
