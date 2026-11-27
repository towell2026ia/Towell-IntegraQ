import { describe, expect, it } from "vitest";
import {
  cohort,
  late,
  meanProgress,
  outputMetrics,
  type Action,
  type Output,
} from "./review-outputs";
import { scopedReviewStorage } from "./management-review-data";
import type { ActiveSession } from "./session-data";

const agreement = (changes: Partial<Output> = {}): Output => ({
  id: "d1",
  folio: "RPD-2025-0001",
  origin_year: 2025,
  agreement_date: "2025-01-01",
  title: "Decisión",
  description: "Revisión",
  classification: "resources",
  section_id: "risks",
  priority: "medium",
  auth_state: "authorized",
  execution: "pending",
  actionable: true,
  due_date: "2025-05-01",
  owner_id: null,
  owner_name: null,
  revision: 1,
  justification: null,
  resources: null,
  process_id: null,
  evidence_file_id: null,
  review_id: null,
  source_link_id: null,
  historic: false,
  historic_item: null,
  resolution: null,
  completed_at: null,
  ...changes,
});
describe("Salidas de Revisión por la Dirección", () => {
  const today = "2026-11-27";
  it("separa el cero del conjunto sin acuerdos evaluables", () => {
    expect(
      outputMetrics(
        [
          agreement({ auth_state: "draft" }),
          agreement({ auth_state: "review" }),
          agreement({ auth_state: "cancelled" }),
        ],
        2025,
        today,
      ),
    ).toEqual({
      authorized: 0,
      working: 0,
      closed: 0,
      overdue: 0,
      previous: 0,
      received: null,
      onTime: null,
    });
    expect(outputMetrics([agreement()], 2025, today).received).toBe(0);
  });
  it("conserva el año de origen y separa cumplimiento, puntualidad y arrastres", () => {
    const closed = agreement({
      execution: "completed",
      completed_at: "2026-01-01T03:00:00Z",
    });
    const open = agreement({ id: "d2", execution: "in_progress" });
    const old = agreement({ id: "d3", origin_year: 2024 });
    expect(cohort([closed, open, old], 2025, "completedYear", today)).toEqual([
      closed,
    ]);
    expect(cohort([closed, open, old], 2025, "previous", today)).toEqual([old]);
    expect(cohort([closed, open, old], 2026, "previous", today)).toEqual([
      open,
      old,
    ]);
    expect(outputMetrics([closed, open, old], 2025, today)).toEqual({
      authorized: 2,
      working: 1,
      closed: 1,
      overdue: 1,
      previous: 1,
      received: 50,
      onTime: 0,
    });
  });
  it("calcula el avance exclusivamente sobre acciones activas", () => {
    const act = (state: Action["state"], progress: number) =>
      ({ state, progress }) as Action;
    expect(meanProgress([])).toBeNull();
    expect(
      meanProgress([
        act("in_progress", 25),
        act("review", 100),
        act("cancelled", 0),
      ]),
    ).toBe(63);
    expect(late(today, "pending", today)).toBe(false);
    expect(late("2025-01-01", "review", today)).toBe(true);
    expect(late("2025-01-01", "cancelled", today)).toBe(false);
  });
  it("protege los registros privados del navegador y conserva el histórico sin titular", () => {
    const data = new Map([["integraq.managementReviews.v2", "histórico"]]);
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    };
    const scoped = (id: string, org = "org") =>
      scopedReviewStorage(storage, {
        authUserId: id,
        organizationId: org,
      } as ActiveSession);
    const key = "integraq.managementReviews.v2";
    scoped("A").setItem(key, "registro A");
    expect(scoped("A").getItem(key)).toBe("registro A");
    expect(scoped("B").getItem(key)).toBeNull();
    expect(scoped("A", "otro").getItem(key)).toBeNull();
    expect(data.get(key)).toBe("histórico");
  });
});
