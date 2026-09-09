import { describe, expect, it } from "vitest";

import {
  buildSessionFromAccount,
  createUserAccessAccount,
  derivePositionAccess,
} from "@/lib/user-access-data";

describe("organization-driven user access", () => {
  it("maps responsible positions to modifier access", () => {
    const access = derivePositionAccess("PU-12");
    expect(access?.documentAccess).toContainEqual({
      processId: "P-13",
      role: "modifier",
      inheritedFromPositionId: "PU-12",
    });
    expect(access?.assignedModuleIds).toContain("documents");
    expect(access?.assignedModuleIds).toContain("corrective-actions");
  });

  it("maps approving positions to authorizer access", () => {
    const access = derivePositionAccess("PU-02");
    expect(
      access?.documentAccess.find((item) => item.processId === "P-13")?.role,
    ).toBe("authorizer");
    expect(access?.assignedModuleIds).toContain("audits");
    expect(access?.assignedModuleIds).toContain("management-review");
  });

  it("maps participant and support positions to viewer access", () => {
    const access = derivePositionAccess("PU-16");
    expect(access?.documentAccess.every((item) => item.role === "viewer")).toBe(true);
  });

  it("requires an organigram position for internal and administrator accounts", () => {
    const shared = {
      id: "USR-NEW",
      fullName: "Usuario nuevo",
      email: "usuario@towell.test",
      createdAt: "2026-08-17T12:00:00.000Z",
    };
    expect(createUserAccessAccount({ ...shared, userType: "Usuario interno" })).toBeNull();
    expect(createUserAccessAccount({ ...shared, userType: "Administrador" })).toBeNull();
  });

  it("builds an internal session with position, processes, menus and document roles", () => {
    const account = createUserAccessAccount({
      id: "USR-TEJ-001",
      fullName: "Jefatura de Tejido",
      email: "tejido@towell.test",
      userType: "Usuario interno",
      positionId: "PU-12",
      createdAt: "2026-08-17T12:00:00.000Z",
    });
    expect(account).not.toBeNull();
    const session = buildSessionFromAccount(account!);
    expect(session.positionId).toBe("PU-12");
    expect(session.assignedProcessIds).toContain("P-13");
    expect(session.assignedModuleIds).toContain("documents");
    expect(session.assignedModuleIds).toContain("continuous-improvement");
    expect(session.continuousImprovementRole).toBe("submitter");
    expect(session.documentAccess?.find((item) => item.processId === "P-13")?.role).toBe("modifier");
  });

  it("uses positions loaded from Supabase when creating a user", () => {
    const positionCatalog = [{
      id: "PU-29",
      name: "supervisor de producción",
      level: 5,
      parentId: "PU-12",
      branch: "Operaciones",
      processLinks: [{ processId: "P-13", relationship: "participant" as const }],
    }];
    const account = createUserAccessAccount({
      id: "USR-SUP-001",
      fullName: "Usuario supervisor",
      email: "supervisor@towell.test",
      userType: "Usuario interno",
      positionId: "PU-29",
      positionCatalog,
      createdAt: "2026-09-09T12:00:00.000Z",
    });
    expect(account).toMatchObject({
      positionId: "PU-29",
      positionName: "supervisor de producción",
      assignedProcessIds: ["P-13"],
    });
  });

  it("assigns the continuous improvement manager role without creating a new user type", () => {
    const account = createUserAccessAccount({
      id: "USR-MC-001",
      fullName: "Responsable de mejora",
      email: "mejora@towell.test",
      userType: "Usuario interno",
      positionId: "PU-16",
      continuousImprovementRole: "manager",
      createdAt: "2026-08-17T12:00:00.000Z",
    });
    expect(account?.continuousImprovementRole).toBe("manager");
    expect(account?.assignedModuleIds).toContain("continuous-improvement");
  });

  it("keeps an external customer on one company portal", () => {
    const account = createUserAccessAccount({
      id: "EXT-CLI-002",
      fullName: "Contacto cliente",
      email: "cliente@example.test",
      userType: "Cliente",
      companyId: "customer-002",
      companyName: "Cliente exportación B",
      createdAt: "2026-08-17T12:00:00.000Z",
    });
    const session = buildSessionFromAccount(account!);
    expect(session.assignedModuleIds).toEqual(["customer-portal"]);
    expect(session.assignedProcessIds).toEqual([]);
    expect(session.externalParty?.companyId).toBe("customer-002");
  });
});
