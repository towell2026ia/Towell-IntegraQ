import { describe, expect, it } from "vitest";

import {
  calculateNextDueDate,
  getDueStatus,
  isCorrectiveActionOverdue,
} from "@/lib/domain";
import type { CorrectiveAction } from "@/lib/types";

describe("calculateNextDueDate", () => {
  it("preserves the day when it exists in the target month", () => {
    expect(calculateNextDueDate("2026-07-15", 3)).toBe("2026-10-15");
  });

  it("uses the final day when the target month is shorter", () => {
    expect(calculateNextDueDate("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("getDueStatus", () => {
  it("marks overdue dates", () => {
    expect(getDueStatus("2026-07-01", "2026-07-29")).toBe("overdue");
  });

  it("marks dates within the warning window", () => {
    expect(getDueStatus("2026-08-12", "2026-07-29")).toBe("due_soon");
  });

  it("keeps distant dates current", () => {
    expect(getDueStatus("2026-10-15", "2026-07-29")).toBe("current");
  });
});

describe("isCorrectiveActionOverdue", () => {
  const action: CorrectiveAction = {
    id: "ca-1",
    folio: "AC-001",
    title: "Acción de prueba",
    problem: "Problema de prueba",
    source: "internal",
    severity: "medium",
    area: "Calidad",
    owner: "Responsable",
    createdAt: "2026-06-01",
    dueDate: "2026-07-01",
    status: "implementation",
    progress: 50,
    evidenceCount: 0,
  };

  it("marks an open action past its due date", () => {
    expect(isCorrectiveActionOverdue(action, "2026-07-29")).toBe(true);
  });

  it("does not mark a closed action as overdue", () => {
    expect(
      isCorrectiveActionOverdue(
        { ...action, status: "closed" },
        "2026-07-29",
      ),
    ).toBe(false);
  });
});
