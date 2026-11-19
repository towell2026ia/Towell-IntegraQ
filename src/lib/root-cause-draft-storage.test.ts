import { afterEach, expect, it, vi } from "vitest";
import { loadRootCauseDraft, saveRootCauseDraft } from "@/lib/root-cause-draft-storage";

const draftId = "c9d62a40-bbc9-48dc-9415-6020721261df";
const responsibleId = "2a4b8c39-a6a2-47f2-9b2b-c8074f39b5d2";
const plan = {
  id: "40fc1982-e13f-4d98-bac6-990a8791bbd0",
  description: "Revisar y ajustar la guía de inspección.",
  causeCategory: "method" as const,
  owner: "Responsable del proceso",
  ownerUserId: responsibleId,
  dueDate: "2026-12-15",
  status: "pending" as const,
};

afterEach(() => vi.unstubAllGlobals());

it("T04.1 mock: saves and reloads all four plan fields without removed verification fields", async () => {
  const stored = new Map<string, Record<string, unknown>>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://integraq.test");
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { id: string; revision: number; payload: Record<string, unknown> };
      stored.set(body.id, body.payload);
      return Response.json({ id: body.id, revision: body.revision + 1, updatedAt: "2026-11-19T18:00:00.000Z" });
    }
    return Response.json({ draft: { id: draftId, revision: 1, currentStep: 7, processId: "P-13", source: "internal", updatedAt: "2026-11-19T18:00:00.000Z", payload: stored.get(url.searchParams.get("id") ?? "") } });
  });
  vi.stubGlobal("fetch", fetchMock);

  const payload = { step: 7, draft: { origin: "internal", processId: "P-13", plans: [plan] } };
  await saveRootCauseDraft({ id: draftId, revision: 0, currentStep: 7, payload });
  const reopened = await loadRootCauseDraft(draftId);

  const restoredPlan = (reopened.draft.payload.draft as { plans: typeof plan[] }).plans[0];
  expect(restoredPlan).toEqual(plan);
  expect(restoredPlan).not.toHaveProperty("expectedResult");
  expect(restoredPlan).not.toHaveProperty("completionEvidence");
  expect(restoredPlan).not.toHaveProperty("effectivenessMethod");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
