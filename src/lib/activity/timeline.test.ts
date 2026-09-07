import { describe, expect, it } from "vitest";

import { changedFields, getActivityTimeline } from "./timeline";

describe("activity timeline", () => {
  it("stores only changed fields and orders newest first", async () => {
    expect(changedFields({ probability: 4, title: "Riesgo" }, { probability: 3, title: "Riesgo" })).toEqual({ previousValue: { probability: 4 }, newValue: { probability: 3 } });
    const event = (id: string, createdAt: string) => ({ id, userNameSnapshot: "Usuario", module: "risks", entityType: "risk", action: "edit", origin: "human" as const, createdAt });
    const result = await getActivityTimeline("risk", "r1", { list: async () => [event("old", "2026-01-01"), event("new", "2026-09-07")] });
    expect(result.map((item) => item.id)).toEqual(["new", "old"]);
  });
});
