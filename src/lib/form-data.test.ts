import { describe, expect, it } from "vitest";

import { processCatalog } from "./configuration-data";
import {
  appFormCatalog,
  buildFormDashboard,
  createDraftAppForm,
  createImportedAppForm,
  generateDashboardDefinition,
  getFormsForProcess,
  serializeFormRecordsToCsv,
} from "./form-data";

describe("application form catalog", () => {
  it("keeps registration numbers unique and links every form to a process", () => {
    const registrationNumbers = appFormCatalog.map(
      (form) => form.registrationNumber,
    );
    const processIds = new Set(processCatalog.map((process) => process.id));

    expect(new Set(registrationNumbers).size).toBe(registrationNumbers.length);
    expect(appFormCatalog.every((form) => processIds.has(form.processId))).toBe(true);
  });

  it("returns only the forms assigned to the selected process", () => {
    expect(getFormsForProcess("P-08").map((form) => form.registrationNumber)).toEqual([
      "F-CA-25",
    ]);
  });

  it("recalculates dashboard values without changing its generated definition", () => {
    const form = appFormCatalog[0];
    const asOf = new Date("2026-08-11T12:00:00.000Z");
    const initial = buildFormDashboard(form, asOf);
    const updated = buildFormDashboard(
      {
        ...form,
        records: [
          ...form.records,
          {
            id: "REG-F-VE-12-0007",
            createdAt: "2026-08-11T13:00:00.000Z",
            status: "Cerrado",
            values: {
              visitDate: "2026-08-11",
              customer: "Cliente prueba",
              channel: "Presencial",
              result: "Acuerdo",
              satisfaction: 100,
              notes: "",
            },
          },
        ],
      },
      asOf,
    );

    expect(initial.totalRecords).toBe(6);
    expect(updated.totalRecords).toBe(7);
    expect(updated.recordsThisMonth).toBe(initial.recordsThisMonth + 1);
    expect(form.dashboard.id).toBe("AG-DASH-F-VE-12");
    expect(form.dashboard.version).toBe(1);
  });

  it("summarizes business results instead of form completion counts", () => {
    const supplierReport = buildFormDashboard(
      appFormCatalog.find((form) => form.id === "FORM-CA-25")!,
      new Date("2026-08-11T12:00:00.000Z"),
    );
    const weavingCheck = buildFormDashboard(
      appFormCatalog.find((form) => form.id === "FORM-TE-01")!,
      new Date("2026-08-11T12:00:00.000Z"),
    );

    expect(supplierReport.insights.find((item) => item.id === "rejected-total")?.value).toBe("61");
    expect(weavingCheck.insights.find((item) => item.id === "release-rate")?.value).toBe("66.7");
    expect(supplierReport.keyFindings.length).toBeGreaterThan(0);
  });

  it("lets the dashboard agent regenerate a definition from selected result fields", () => {
    const form = appFormCatalog[0];
    const generated = generateDashboardDefinition(
      form,
      "Priorizar acuerdos y satisfacción comercial.",
      "2026-08-17T12:00:00.000Z",
      { categoryField: "result", metricField: "satisfaction" },
    );

    expect(generated.version).toBe(form.dashboard.version + 1);
    expect(generated.objective).toBe("Priorizar acuerdos y satisfacción comercial.");
    expect(generated.categoryField).toBe("result");
    expect(generated.metricField).toBe("satisfaction");
    expect(generated.insights).toHaveLength(4);
  });

  it("creates a process-linked draft with an editable form and dashboard", () => {
    const form = createDraftAppForm({
      id: "FORM-TEST",
      registrationNumber: "f-ca-99",
      name: "Registro de prueba",
      processId: "P-08",
      createdAt: "2026-08-17T12:00:00.000Z",
    });

    expect(form.registrationNumber).toBe("F-CA-99");
    expect(form.status).toBe("Borrador");
    expect(form.processId).toBe("P-08");
    expect(form.fields.length).toBeGreaterThan(0);
    expect(form.dashboard.insights.length).toBeGreaterThan(0);
  });

  it("creates an imported form and generates its first result dashboard", () => {
    const form = createImportedAppForm({
      id: "FORM-IMPORT",
      registrationNumber: "F-TE-44",
      name: "Verificación importada",
      processId: "P-16",
      createdAt: "2026-08-17T12:00:00.000Z",
      fields: [
        { id: "fecha", label: "Fecha", type: "date", required: true },
        { id: "resultado", label: "Resultado", type: "select", required: true, options: ["Conforme", "No conforme"] },
        { id: "metros", label: "Metros", type: "number", required: true, unit: "m" },
      ],
    });

    expect(form.status).toBe("Borrador");
    expect(form.fields).toHaveLength(3);
    expect(form.dashboard.categoryField).toBe("resultado");
    expect(form.dashboard.metricField).toBe("metros");
    expect(form.dashboard.insights.length).toBeGreaterThan(0);
  });

  it("serializes dynamic fields and escapes values for spreadsheet export", () => {
    const form = appFormCatalog[0];
    const csv = serializeFormRecordsToCsv({
      ...form,
      records: [
        {
          ...form.records[0],
          values: {
            ...form.records[0].values,
            notes: 'Medida "aprobada", sin ajuste',
          },
        },
      ],
    });

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Registro","Fecha de captura","Estado"');
    expect(csv).toContain('"Calificación","Observaciones"');
    expect(csv).toContain('"Medida ""aprobada"", sin ajuste"');
  });
});
