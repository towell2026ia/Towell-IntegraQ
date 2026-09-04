import { describe, expect, it } from "vitest";

import { computeHierarchyLevels, interpretOrganizationGrid } from "./organization-chart-data";

describe("organization chart interpretation", () => {
  it("reads tabular positions and keeps levels below four", () => {
    const draft = interpretOrganizationGrid({
      sourceName: "organigrama.xlsx",
      processName: "Calidad",
      grid: [
        ["Puesto", "Nivel", "Reporta a", "Área"],
        ["Gerente de Calidad", "3", "Dirección General", "Calidad"],
        ["Jefe de Calidad", "4", "Gerente de Calidad", "Calidad"],
        ["Auditor de Calidad", "5", "Jefe de Calidad", "Calidad"],
      ],
    });
    expect(draft.positions.at(-1)).toMatchObject({
      name: "Auditor de Calidad",
      level: 5,
      parentName: "Jefe de Calidad",
    });
  });

  it("infers common production roles from a visual grid", () => {
    const draft = interpretOrganizationGrid({
      sourceName: "organigrama.xlsx",
      processName: "Tejido",
      grid: [["Jefe de Tejido"], ["Supervisor de Producción", "Técnico de Mantenimiento"]],
    });
    expect(draft.positions.map((position) => position.name)).toEqual([
      "Jefe de Tejido",
      "Supervisor de Producción",
      "Técnico de Mantenimiento",
    ]);
    expect(draft.positions[1].level).toBe(5);
  });

  it("derives levels deeper than the legacy database level", () => {
    const positions = computeHierarchyLevels([
      { id: "PU-01", level: 1 },
      { id: "PU-02", parentId: "PU-01", level: 2 },
      { id: "PU-03", parentId: "PU-02", level: 3 },
      { id: "PU-04", parentId: "PU-03", level: 4 },
      { id: "PU-29", parentId: "PU-04", level: 4 },
      { id: "PU-30", parentId: "PU-29", level: 4 },
    ]);
    expect(positions.at(-2)?.level).toBe(5);
    expect(positions.at(-1)?.level).toBe(6);
  });
});
