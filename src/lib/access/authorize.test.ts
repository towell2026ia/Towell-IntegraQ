import { describe, expect, it } from "vitest";

import type { ActiveSession } from "@/lib/session-data";

import { authorize } from "./authorize";

const internal: ActiveSession = { userId: "u1", authUserId: "u1", name: "Usuario", shortName: "U", initials: "U", position: "Dueño", department: "Calidad", company: "Towell", userType: "Usuario interno", assignedProcessIds: ["P-08"], assignedModuleIds: ["risks"], moduleActionPermissions: [{ moduleId: "risks", action: "update" }] };

describe("authorize", () => {
  it("allows an administrator with a traceable override origin", () => {
    expect(authorize({ user: { ...internal, userType: "Administrador" }, permission: "risks.approve" })).toMatchObject({ allowed: true, origin: "admin_override", scope: "global" });
  });

  it("allows an explicit legacy permission inside its process", () => {
    expect(authorize({ user: internal, permission: "risks.edit", record: { processId: "P-08" } }).allowed).toBe(true);
  });

  it("denies missing permissions and records outside scope", () => {
    expect(authorize({ user: internal, permission: "risks.approve", record: { processId: "P-08" } }).reason).toBe("FORBIDDEN");
    expect(authorize({ user: internal, permission: "risks.edit", record: { processId: "P-17" } }).reason).toBe("OUTSIDE_SCOPE");
  });

  it("isolates customers and suppliers by company id", () => {
    const customer: ActiveSession = { ...internal, userType: "Cliente", assignedProcessIds: [], moduleActionPermissions: [], externalParty: { kind: "customer", companyId: "customer-a", companyName: "A" } };
    expect(authorize({ user: customer, permission: "documents.file.read", record: { companyId: "customer-a" } }).allowed).toBe(true);
    expect(authorize({ user: customer, permission: "documents.file.read", record: { companyId: "customer-b" } }).reason).toBe("OUTSIDE_SCOPE");
  });

  it("expires temporary grants", () => {
    expect(authorize({ user: internal, permission: "audits.execute", record: { assignedUserIds: ["u1"] }, grants: [{ permission: "audits.execute", scope: "assigned_records", endsAt: "2026-01-01T00:00:00Z" }], now: new Date("2026-09-07T00:00:00Z") }).reason).toBe("FORBIDDEN");
  });
});
