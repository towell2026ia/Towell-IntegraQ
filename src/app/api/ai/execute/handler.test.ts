import { describe, expect, it } from "vitest";

import { MemoryAiActivitySink } from "@/ai/core/audit";
import type { ContextRepository } from "@/ai/core/context";
import type { ActiveSession } from "@/lib/session-data";

import { handleExecuteAiRequest } from "./handler";

const administrator: ActiveSession = { userId: "USR-1", authUserId: "auth-1", name: "Admin", shortName: "Admin", initials: "A", position: "Administrador", department: "Calidad", company: "Towell", userType: "Administrador", assignedProcessIds: [] };
const repository: ContextRepository = {
  async getOrganizationId() { return "org-1"; },
  async getProcess(id) { return { processId: id, processName: "Calidad" }; },
  async getRecord() { return null; },
  async getSources() { return []; },
};

function request(body: unknown) {
  return new Request("http://localhost/api/ai/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/ai/execute", () => {
  it("requires an authenticated session", async () => {
    const response = await handleExecuteAiRequest(request({}), { getSession: async () => null, repository, auditSink: new MemoryAiActivitySink() });
    expect(response.status).toBe(401);
  });

  it("validates the common request contract", async () => {
    const response = await handleExecuteAiRequest(request({ requestId: "req-invalid" }), { getSession: async () => administrator, repository, auditSink: new MemoryAiActivitySink() });
    expect(response.status).toBe(400);
  });

  it("builds context, writes audit fingerprints and returns a disabled capability", async () => {
    const sink = new MemoryAiActivitySink();
    const response = await handleExecuteAiRequest(request({ requestId: "req-1", task: "suggest", capability: "risks.evaluate", module: "risks", action: "evaluate", context: { processId: "P-08", include: ["process", "documents"] }, input: { title: "Riesgo" }, metadata: {} }), { getSession: async () => administrator, repository, auditSink: sink });
    const payload = await response.json() as { status: string; error: { code: string } };
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ status: "disabled", error: { code: "CAPABILITY_DISABLED" } });
    expect(sink.events[0].inputFingerprint).toHaveLength(64);
    expect(sink.events[0].contextFingerprint).toHaveLength(64);
  });
});

