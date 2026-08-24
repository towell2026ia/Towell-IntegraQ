import { describe, expect, it } from "vitest";

import { demoMeasurementAssets } from "@/lib/demo-data";
import {
  buildMetrologyAgentContext,
  getCurrentReferenceStandards,
  getVerificationReadiness,
  normalizeMeasurementAssets,
} from "@/lib/metrology-data";
import type { MeasurementAsset } from "@/lib/types";

const sourceDate = "2025-06-13";
const today = "2026-08-17";

describe("F-CA-37 metrology catalog", () => {
  it("loads the complete instrument and standard register", () => {
    expect(demoMeasurementAssets).toHaveLength(79);
    expect(demoMeasurementAssets.filter((asset) => asset.activity === "verification")).toHaveLength(56);
    expect(demoMeasurementAssets.filter((asset) => asset.activity === "calibration" && !asset.isReferenceStandard)).toHaveLength(14);
    expect(demoMeasurementAssets.filter((asset) => asset.isReferenceStandard)).toHaveLength(9);
  });

  it("preserves the nine standards as externally calibrated records", () => {
    const standards = demoMeasurementAssets.filter((asset) => asset.isReferenceStandard);
    expect(standards.every((asset) => asset.activity === "calibration")).toBe(true);
    expect(getCurrentReferenceStandards(demoMeasurementAssets, sourceDate)).toHaveLength(9);
    expect(getCurrentReferenceStandards(demoMeasurementAssets, today)).toHaveLength(0);
  });

  it("links verification equipment to standards by measurement category", () => {
    const scale = demoMeasurementAssets.find((asset) => asset.code === "TOW-BA-001")!;
    const tape = demoMeasurementAssets.find((asset) => asset.code === "TOW-LON-001")!;

    const scaleAtSourceDate = getVerificationReadiness(scale, demoMeasurementAssets, sourceDate);
    expect(scaleAtSourceDate.ready).toBe(true);
    expect(scaleAtSourceDate.references).toHaveLength(8);
    expect(scaleAtSourceDate.currentReferences).toHaveLength(8);

    const tapeAtSourceDate = getVerificationReadiness(tape, demoMeasurementAssets, sourceDate);
    expect(tapeAtSourceDate.ready).toBe(true);
    expect(tapeAtSourceDate.reference?.code).toBe("TOW-LON-01");

    const scaleToday = getVerificationReadiness(scale, demoMeasurementAssets, today);
    expect(scaleToday.ready).toBe(false);
    expect(scaleToday.reason).toContain("8 patrones");
  });

  it("restores missing catalog records while preserving saved changes", () => {
    const saved = [{
      ...demoMeasurementAssets.find((asset) => asset.code === "TOW-BA-001")!,
      owner: "Responsable actualizado",
    }] as MeasurementAsset[];
    const normalized = normalizeMeasurementAssets(saved, demoMeasurementAssets);
    expect(normalized).toHaveLength(79);
    expect(normalized.find((asset) => asset.code === "TOW-BA-001")?.owner).toBe("Responsable actualizado");
  });

  it("prepares technical and standard context for MetrologyCheckAI", () => {
    const asset = demoMeasurementAssets.find((candidate) => candidate.code === "TOW-BA-001")!;
    const context = buildMetrologyAgentContext(asset, demoMeasurementAssets, today, "Revisa la evidencia.");
    expect(context).toContain("MetrologyCheckAI");
    expect(context).toContain("modelo XK3118T1");
    expect(context).toContain("PE-TOW-001");
    expect(context).toContain("Revisa la evidencia.");
  });
});
