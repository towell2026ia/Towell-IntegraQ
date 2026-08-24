import { describe, expect, it } from "vitest";

import {
  canAccessCompanyRecord,
  canAccessModule,
  resolveAuthorizedModule,
} from "@/lib/access-policy";
import { workspaceModuleMeta } from "@/lib/navigation";
import { canAccessProcess, type ActiveSession } from "@/lib/session-data";

const baseSession: ActiveSession = {
  userId: "USR-TEST",
  name: "Usuario de prueba",
  shortName: "Usuario",
  initials: "UP",
  position: "Pruebas",
  department: "Calidad",
  company: "Towell",
  userType: "Usuario interno",
  assignedProcessIds: ["P-08"],
  assignedModuleIds: ["documents", "indicators"],
};

describe("access policy", () => {
  it("gives administrators access to every workspace module", () => {
    const admin = { ...baseSession, userType: "Administrador" as const };
    expect(
      Object.keys(workspaceModuleMeta).every((module) =>
        canAccessModule(admin, module as keyof typeof workspaceModuleMeta),
      ),
    ).toBe(true);
  });

  it("limits an internal user to home and assigned modules", () => {
    expect(canAccessModule(baseSession, "home")).toBe(true);
    expect(canAccessModule(baseSession, "documents")).toBe(true);
    expect(canAccessModule(baseSession, "suppliers")).toBe(false);
  });

  it("limits a customer to the portal for its linked company", () => {
    const customer: ActiveSession = {
      ...baseSession,
      userType: "Cliente",
      company: "Cliente corporativo A",
      externalParty: {
        kind: "customer",
        companyId: "customer-001",
        companyName: "Cliente corporativo A",
      },
    };

    expect(canAccessModule(customer, "customer-portal")).toBe(true);
    expect(canAccessModule(customer, "home")).toBe(false);
    expect(canAccessModule(customer, "customers")).toBe(false);
    expect(canAccessModule(customer, "supplier-portal")).toBe(false);
    expect(canAccessProcess({ ...customer, assignedProcessIds: ["P-08"] }, "P-08")).toBe(false);
    expect(resolveAuthorizedModule(customer, "indicators")).toBe(
      "customer-portal",
    );
    expect(canAccessCompanyRecord(customer, "customer", "customer-001")).toBe(true);
    expect(canAccessCompanyRecord(customer, "customer", "customer-002")).toBe(false);
  });

  it("limits a supplier to the portal for its linked company", () => {
    const supplier: ActiveSession = {
      ...baseSession,
      userType: "Proveedor",
      company: "United Dragon",
      externalParty: {
        kind: "supplier",
        companyId: "supplier-022",
        companyName: "United Dragon",
      },
    };

    expect(canAccessModule(supplier, "supplier-portal")).toBe(true);
    expect(canAccessModule(supplier, "suppliers")).toBe(false);
    expect(canAccessModule(supplier, "corrective-actions")).toBe(false);
    expect(canAccessModule(supplier, "customer-portal")).toBe(false);
    expect(resolveAuthorizedModule(supplier, "audits")).toBe(
      "supplier-portal",
    );
    expect(canAccessCompanyRecord(supplier, "supplier", "supplier-022")).toBe(true);
    expect(canAccessCompanyRecord(supplier, "supplier", "supplier-018")).toBe(false);
  });

  it("shows a closed portal when an external session has no valid company scope", () => {
    const invalidCustomer: ActiveSession = {
      ...baseSession,
      userType: "Cliente",
      externalParty: undefined,
    };
    expect(canAccessModule(invalidCustomer, "customer-portal")).toBe(false);
    expect(resolveAuthorizedModule(invalidCustomer, "documents")).toBe(
      "customer-portal",
    );
  });
});
