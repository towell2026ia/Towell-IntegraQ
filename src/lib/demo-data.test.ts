import { describe, expect, it } from "vitest";

import {
  demoCorrectiveActions,
  enrichSavedCorrectiveActions,
} from "@/lib/demo-data";

describe("corrective action demo migration", () => {
  it("adds new A3 demo fields without overwriting saved progress", () => {
    const legacyCustomerAction = {
      ...demoCorrectiveActions.find((action) => action.id === "ca-002")!,
      status: "effectiveness" as const,
      progress: 91,
      relatedParty: undefined,
      a3: undefined,
    };

    const [enriched] = enrichSavedCorrectiveActions([legacyCustomerAction]);

    expect(enriched.status).toBe("effectiveness");
    expect(enriched.progress).toBe(91);
    expect(enriched.relatedParty).toBe("Cliente corporativo A");
    expect(enriched.a3?.plans).toHaveLength(2);
  });

  it("leaves user-created actions unchanged", () => {
    const customAction = {
      ...demoCorrectiveActions[0],
      id: "custom-action",
      title: "Acción creada por el usuario",
    };

    expect(enrichSavedCorrectiveActions([customAction])[0]).toEqual(customAction);
  });
});
