import { describe, expect, it } from "vitest";

import { buildInitialIndicatorDefinitions, canSubmitIndicator } from "@/lib/indicator-data";
import {
  buildDefaultCaptureWindows,
  businessDateBoundary,
  formatBusinessDateInput,
  getIndicatorWindowState,
} from "@/lib/indicators/indicator-windows";

describe("configurable indicator capture windows", () => {
  it("builds the standard 15-day windows after each quarter", () => {
    const windows = buildDefaultCaptureWindows(2026, 15);
    expect(formatBusinessDateInput(windows.Q1.opensAt)).toBe("2026-04-01");
    expect(formatBusinessDateInput(windows.Q1.closesAt)).toBe("2026-04-15");
    expect(formatBusinessDateInput(windows.Q3.opensAt)).toBe("2026-10-01");
    expect(formatBusinessDateInput(windows.Q3.closesAt)).toBe("2026-10-15");
    expect(formatBusinessDateInput(windows.Q4.opensAt)).toBe("2027-01-01");
    expect(formatBusinessDateInput(windows.Q4.closesAt)).toBe("2027-01-15");
  });

  it("uses America/Mexico_City boundaries without a hardcoded offset", () => {
    expect(businessDateBoundary("2026-10-01", "start")).toBe("2026-10-01T06:00:00.000Z");
    expect(businessDateBoundary("2026-10-15", "end")).toBe("2026-10-16T05:59:59.999Z");
  });

  it.each([
    ["2026-09-30T23:59:59-06:00", "scheduled", false],
    ["2026-10-01T00:00:00-06:00", "open", true],
    ["2026-10-10T12:00:00-06:00", "open", true],
    ["2026-10-16T00:00:00-06:00", "closed", false],
  ] as const)("keeps frontend decisions aligned at %s", (date, state, allowed) => {
    const indicator = buildInitialIndicatorDefinitions()[0];
    const window = indicator.captureWindows?.["2026"].Q3;
    const now = new Date(date);
    expect(getIndicatorWindowState(window, now)).toBe(state);
    expect(canSubmitIndicator(indicator, 2026, "Q3", now)).toBe(allowed);
  });

  it("allows an administrator-configured exception through October 20", () => {
    const indicator = buildInitialIndicatorDefinitions()[0];
    indicator.captureWindows!["2026"].Q3 = {
      opensAt: businessDateBoundary("2026-10-01", "start"),
      closesAt: businessDateBoundary("2026-10-20", "end"),
    };
    expect(canSubmitIndicator(indicator, 2026, "Q3", new Date("2026-10-20T20:00:00-06:00"))).toBe(true);
    expect(canSubmitIndicator(indicator, 2026, "Q3", new Date("2026-10-21T00:00:00-06:00"))).toBe(false);
  });
});
