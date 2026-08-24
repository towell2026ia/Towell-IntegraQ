import { describe, expect, it } from "vitest";

import { demoCorrectiveActions } from "@/lib/demo-data";
import {
  getCustomerPortalData,
  getSupplierPortalData,
  resolvePortalCompany,
} from "@/lib/portal-access";
import type { ActiveSession } from "@/lib/session-data";

const customerSession: ActiveSession = {
  userId: "EXT-CLI-001",
  name: "Contacto cliente",
  shortName: "Contacto",
  initials: "CC",
  position: "Cliente",
  department: "Externo",
  company: "Cliente corporativo A",
  userType: "Cliente",
  assignedProcessIds: [],
  externalParty: {
    kind: "customer",
    companyId: "customer-001",
    companyName: "Nombre no confiable",
  },
};

describe("portal company isolation", () => {
  it("resolves the canonical customer by immutable company ID", () => {
    expect(resolvePortalCompany(customerSession, "customer")).toEqual({
      companyId: "customer-001",
      companyName: "Cliente corporativo A",
    });
    expect(resolvePortalCompany(customerSession, "supplier")).toBeNull();
  });

  it("returns only actions and audits belonging to the selected customer", () => {
    const firstCustomer = getCustomerPortalData(
      "customer-001",
      demoCorrectiveActions,
    );
    const secondCustomer = getCustomerPortalData(
      "customer-002",
      demoCorrectiveActions,
    );

    expect(firstCustomer.actions.map((item) => item.id)).toEqual(["ca-002"]);
    expect(firstCustomer.audits.every((item) => item.companyId === "customer-001")).toBe(true);
    expect(secondCustomer.actions).toHaveLength(0);
    expect(secondCustomer.audits.every((item) => item.companyId === "customer-002")).toBe(true);
  });

  it("returns RNCP, audits and plans only for the selected supplier", () => {
    const unitedDragon = getSupplierPortalData("supplier-022");
    const anotherSupplier = getSupplierPortalData("supplier-018");

    expect(unitedDragon.rncp.map((item) => item.id)).toEqual(["RNCP0204"]);
    expect(unitedDragon.audits.map((item) => item.id)).toEqual([
      "AUD-PROV-UD-2026",
    ]);
    expect(unitedDragon.plans.map((item) => item.id)).toEqual([
      "PLAN-RNCP0204",
    ]);
    expect(anotherSupplier.rncp).toHaveLength(0);
    expect(anotherSupplier.audits).toHaveLength(0);
    expect(anotherSupplier.plans).toHaveLength(0);
  });
});
