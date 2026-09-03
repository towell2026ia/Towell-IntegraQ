import { describe, expect, it } from "vitest";

import { directionCandidateFingerprint, parseDirectionImportRows } from "@/lib/risk-direction-import";

describe("parseDirectionImportRows", () => {
  it("imports a manually prepared spreadsheet by its headers", () => {
    const rows = [
      ["Descripción", "Responsable", "Punto de control", "Avance histórico", "Proceso", "Clasificación"],
      ["Reducir desperdicio", "Jefatura", "Revisión mensual", "35%", "P-13 Tejido", "Objetivo"],
    ];
    const result = parseDirectionImportRows(rows, "historial.xlsx");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ description: "Reducir desperdicio", historicalProgress: 0.35, processId: "P-13", classification: "objective", sourceType: "file" });
  });

  it("recognizes the legacy B:U matrix layout", () => {
    const row = Array(20).fill(null);
    row[12] = "Compras";
    row[13] = "Revisión trimestral";
    row[16] = "Homologar proveedor alterno";
    row[18] = 0.5;
    const result = parseDirectionImportRows([row], "matriz-2025.xlsx");
    expect(result[0]).toMatchObject({ description: "Homologar proveedor alterno", responsibleLabel: "Compras", historicalProgress: 0.5 });
    expect(result[0].axisWeights).toHaveLength(12);
  });

  it("builds stable fingerprints for duplicate detection", () => {
    expect(directionCandidateFingerprint({ description: "ÁREA crítica", responsibleLabel: "Dirección", controlPoint: "Mensual" }))
      .toBe("area critica|direccion|mensual");
  });
});
