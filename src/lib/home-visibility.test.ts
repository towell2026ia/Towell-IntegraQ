import { describe, expect, it } from "vitest";

import {
  defaultHomeSectionConfigurations,
  getAuthorizedProcessIds,
  getEffectiveHomeProcessIds,
  getVisibleHomeSectionIds,
} from "@/lib/home-visibility";
import { activeSession, type ActiveSession } from "@/lib/session-data";

function internalSession(processIds: string[]): ActiveSession {
  return {
    ...activeSession,
    userId: "USR-TEJIDO-001",
    authUserId: "11111111-1111-4111-8111-111111111111",
    userType: "Usuario interno",
    assignedProcessIds: processIds,
  };
}

describe("home visibility by authorized process", () => {
  it("consolidates every assigned or additional process for an internal user", () => {
    const session = internalSession(["P-13", "P-15", "P-17"]);

    expect(getAuthorizedProcessIds(session)).toEqual(["P-13", "P-15", "P-17"]);
    expect(getEffectiveHomeProcessIds(session, "P-01")).toEqual(["P-13", "P-15", "P-17"]);
  });

  it("lets an administrator select one process without losing global authorization", () => {
    expect(getEffectiveHomeProcessIds(activeSession, "P-13")).toEqual(["P-13"]);
    expect(getAuthorizedProcessIds(activeSession).length).toBeGreaterThan(20);
  });

  it("shows a selected-process block only when its configuration intersects the user scope", () => {
    const configurations = defaultHomeSectionConfigurations.map((section) =>
      section.id === "document-status"
        ? { ...section, scope: "selected-processes" as const, processIds: ["P-13"] }
        : section,
    );

    expect(getVisibleHomeSectionIds(internalSession(["P-13"]), configurations).has("document-status")).toBe(true);
    expect(getVisibleHomeSectionIds(internalSession(["P-17"]), configurations).has("document-status")).toBe(false);
  });

  it("supports explicit user visibility independently from the primary process", () => {
    const configurations = defaultHomeSectionConfigurations.map((section) =>
      section.id === "quality-policy"
        ? {
            ...section,
            scope: "specific-users" as const,
            userIds: ["11111111-1111-4111-8111-111111111111"],
          }
        : section,
    );

    expect(getVisibleHomeSectionIds(internalSession(["P-13"]), configurations).has("quality-policy")).toBe(true);
  });
});
