import { describe, expect, it } from "vitest";

import type { ActiveSession } from "@/lib/session-data";

import { buildIntegraQContext, ContextBuildError, type ContextRepository } from ".";

const user: ActiveSession = { userId: "U-1", authUserId: "auth-1", name: "Ana", shortName: "Ana", initials: "A", position: "auditora", department: "calidad", company: "Towell", userType: "Usuario interno", assignedProcessIds: ["P-08"], assignedModuleIds: ["risks"], moduleActionPermissions: [{ moduleId: "risks", action: "view" }] };
const repository: ContextRepository = {
  async getOrganizationId() { return "org-1"; },
  async getProcess(id) { return id === "P-08" ? { processId: id, processName: "Calidad" } : null; },
  async getRecord(_module, id) { return id === "risk-1" ? { entityType: "risk", entityId: id, entityCode: "R-1", entityStatus: "open", processId: "P-08" } : null; },
  async getSources(include) { return include === "documents" ? [{ type: "document", id: "doc-1", code: "P-SGC-01", title: "Procedimiento" }] : []; },
};

describe("IntegraQ context builder", () => {
  it("builds authenticated user, module, process, record and only requested sources", async () => {
    const context = await buildIntegraQContext({ user, module: "risks", action: "evaluate", route: "/api/ai/execute", recordId: "risk-1", include: ["process", "documents"], repository });
    expect(context.user.userId).toBe("auth-1");
    expect(context.organization?.processName).toBe("Calidad");
    expect(context.record?.entityCode).toBe("R-1");
    expect(context.sources.documents).toHaveLength(1);
    expect(context.sources.indicators).toBeUndefined();
  });

  it("reports a nonexistent record", async () => {
    await expect(buildIntegraQContext({ user, module: "risks", action: "evaluate", route: "/api/ai/execute", recordId: "missing", include: [], repository })).rejects.toMatchObject({ code: "CONTEXT_NOT_FOUND" } satisfies Partial<ContextBuildError>);
  });

  it("filters a process outside the user's permissions", async () => {
    await expect(buildIntegraQContext({ user, module: "risks", action: "evaluate", route: "/api/ai/execute", processId: "P-13", include: ["process"], repository })).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<ContextBuildError>);
  });
});
