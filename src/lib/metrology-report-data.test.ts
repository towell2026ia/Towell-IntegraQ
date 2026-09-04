import { describe, expect, it } from "vitest";

import { calculateMetrologyNextDueDate, getMetrologyReportTemplate, latestReportForAsset, normalizeMetrologyWorkspace, type MetrologyReport } from "@/lib/metrology-report-data";
import { renderMetrologyReportSvg } from "@/lib/metrology-report-svg";
import type { MeasurementAsset } from "@/lib/types";

const baseAsset: MeasurementAsset = { id: "asset-1", code: "TOW-MAS-001", name: "Báscula", location: "Calidad", owner: "Calidad", activity: "verification", frequencyMonths: 2, lastCompletedAt: "2025-01-01", nextDueDate: "2025-03-01", evidenceCount: 0, standard: "Patrón" };

describe("metrology report workflow", () => {
  it("selects the controlled format from the equipment magnitude", () => {
    expect(getMetrologyReportTemplate(baseAsset)).toBe("F-CA-51");
    expect(getMetrologyReportTemplate({ ...baseAsset, name: "Flexómetro", measurementCategory: "LONGITUD" })).toBe("F-CA-53");
    expect(getMetrologyReportTemplate({ ...baseAsset, activity: "calibration" })).toBe("CALIBRATION");
  });

  it("normalizes an empty persisted workspace", () => {
    expect(normalizeMetrologyWorkspace(null, [baseAsset])).toEqual({ assets: [baseAsset], reports: [] });
  });

  it("reprograms from the administrator-defined term", () => {
    expect(calculateMetrologyNextDueDate({ ...baseAsset, frequencyDays: 60 }, "2026-09-04")).toBe("2026-11-03");
    expect(calculateMetrologyNextDueDate({ ...baseAsset, frequencyDays: undefined, frequencyMonths: 3 }, "2026-09-30")).toBe("2026-12-30");
  });

  it("returns only the latest report for one equipment", () => {
    const common = { assetId: "asset-1", assetCode: "TOW-MAS-001", template: "F-CA-51", nextDueDate: "2026-01-01", result: "accepted", performedBy: "Calidad", performedByUserId: "user", signedAt: "2026-01-01", values: {}, createdAt: "2026-01-01" } as unknown as MetrologyReport;
    expect(latestReportForAsset([{ ...common, id: "old", completedAt: "2025-01-01" }, { ...common, id: "new", completedAt: "2026-01-01" }], "asset-1")?.id).toBe("new");
  });

  it("renders the immutable public report as an SVG image", () => {
    const report = { id: "report", assetId: "asset-1", assetCode: "TOW-MAS-001", template: "F-CA-51", completedAt: "2026-09-03", nextDueDate: "2026-11-03", result: "accepted", performedBy: "Usuario de calidad", performedByUserId: "user", signedAt: "2026-09-03T12:00:00Z", createdAt: "2026-09-03T12:00:00Z", values: { periodicity: "2 meses", inspector: "Usuario de calidad", visual: { Funciones: "accepted" }, stabilization: ["1", "1", "1"], eccentricityLoad: "10 kg", eccentricity: ["1"], repeatability: ["1"], indication: [{ reading: "1", nominal: "10", ascending: "10" }], standards: "PE-TOW-001", observations: "Sin desviaciones" } } as MetrologyReport;
    const svg = renderMetrologyReportSvg(baseAsset, report);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Reporte de Verificación de Básculas");
    expect(svg).toContain("Usuario de calidad");
  });

  it("renders certificate delivery and OK confirmation for external calibration", () => {
    const report = { id: "cal-1", assetId: "asset-1", assetCode: "TOW-MAS-001", template: "CALIBRATION", completedAt: "2026-09-04", nextDueDate: "2027-09-04", result: "accepted", performedBy: "Usuario", performedByUserId: "user", signedAt: "2026-09-04T12:00:00Z", createdAt: "2026-09-04T12:00:00Z", values: { reportDeliveryDate: "2026-09-04", confirmedOk: true, certificates: [{ id: "file-1", fileName: "certificado.pdf", mimeType: "application/pdf", sizeBytes: 2048, storageBucket: "integraq-private", storageObjectPath: "path", uploadedAt: "2026-09-04" }] } } as MetrologyReport;
    const svg = renderMetrologyReportSvg({ ...baseAsset, activity: "calibration" }, report);
    expect(svg).toContain("EQUIPO OK");
    expect(svg).toContain("certificado.pdf");
  });
});
