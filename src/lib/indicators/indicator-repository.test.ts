import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfiguredIndicator } from "@/lib/indicator-data";
import {
  disableIndicatorDefinition,
  fetchIndicatorRuntime,
  persistIndicatorDefinition,
  persistIndicatorResult,
} from "@/lib/indicators/indicator-repository";

const indicator = {
  id: "IND-001",
  sourceRow: 1,
  processId: "P-01",
  processIds: ["P-01"],
  area: "Calidad",
  directionObjective: "",
  directionMetric: "",
  qualityObjective: "Cumplir",
  name: "Indicador de prueba",
  leader: "Responsable",
  metric: ">=90%",
  description: "Prueba",
  period: "Trimestral",
  evaluationRules: { compliant: ">=90", marginal: ">=85,<90", noncompliant: "<85" },
  schedule: { "2026": { Q1: "2026-03-31", Q2: "2026-06-30", Q3: "2026-09-30", Q4: "2026-12-31" } },
} satisfies ConfiguredIndicator;

afterEach(() => vi.unstubAllGlobals());

describe("indicator repository", () => {
  it("always reloads the runtime snapshot from the server", async () => {
    const snapshot = {
      definitions: [indicator],
      results: {},
      access: { administrator: false, assignedProcessIds: ["P-01"], canUpdate: true, canView: true },
      settings: { captureDaysAfterClose: 15, timezone: "America/Mexico_City" as const },
      loadedAt: "2026-10-07T18:00:00Z",
      source: "supabase" as const,
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchIndicatorRuntime()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/indicators/runtime", { cache: "no-store" });
  });

  it("persists definitions, results and deactivation through the normalized API", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "uuid-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "result-1", submittedAt: "2026-10-07T18:00:00Z" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "uuid-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await persistIndicatorDefinition(indicator);
    await persistIndicatorResult({ indicatorId: indicator.id, year: 2026, quarter: "Q3", value: 92, comments: "OK" });
    await disableIndicatorDefinition(indicator.id);

    expect(fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit).method])).toEqual([
      ["/api/indicators/runtime", "PUT"],
      ["/api/indicators/runtime", "POST"],
      ["/api/indicators/runtime", "DELETE"],
    ]);
  });

  it("surfaces server failures instead of presenting a local save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "La operación fue rechazada." }), { status: 409 }),
    ));

    await expect(persistIndicatorDefinition(indicator)).rejects.toThrow("La operación fue rechazada.");
  });
});
