import { describe, expect, it } from "vitest";

import { processCatalog } from "./configuration-data";
import {
  appFormCatalog,
  buildFormDashboard,
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
