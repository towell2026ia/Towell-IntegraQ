import { describe, expect, it } from "vitest";

import { interpretExcelGrid, normalizeFormImportDraft } from "./form-import-data";

describe("form import interpretation", () => {
  it("extracts form identity and typed fields from an Excel-like grid", () => {
    const draft = interpretExcelGrid({
      sourceName: "F-CA-77_Registro.xlsx",
      sheetName: "Formato",
      grid: [
        ["Towell", "F-CA-77"],
        ["Registro de inspección de proveedores"],
        [],
        ["Fecha", "Proveedor", "Cantidad rechazada", "Resultado", "Observaciones"],
        ["2026-08-17", "Textiles Centro", "12", "No conforme", "Variación de tono"],
      ],
    });

    expect(draft.registrationNumber).toBe("F-CA-77");
    expect(draft.name).toBe("Registro de inspección de proveedores");
    expect(draft.sheetName).toBe("Formato");
    expect(draft.fields.map((field) => field.label)).toEqual([
      "Fecha",
      "Proveedor",
      "Cantidad rechazada",
      "Resultado",
      "Observaciones",
    ]);
    expect(draft.fields.find((field) => field.label === "Fecha")?.type).toBe("date");
    expect(draft.fields.find((field) => field.label === "Cantidad rechazada")?.type).toBe("number");
    expect(draft.fields.find((field) => field.label === "Resultado")?.type).toBe("select");
  });

  it("normalizes an agent response and rejects empty visual structures", () => {
    const draft = normalizeFormImportDraft(
      {
        registrationNumber: "f-te-44",
        name: "Verificación visual",
        confidence: 0.83,
        fields: [
          { id: "fecha", label: "Fecha", type: "date", required: true, options: [], unit: "" },
          { id: "resultado", label: "Resultado", type: "select", required: true, options: ["Conforme", "No conforme"], unit: "" },
        ],
        warnings: [],
      },
      "foto.jpg",
      "image",
    );

    expect(draft?.registrationNumber).toBe("F-TE-44");
    expect(draft?.sourceType).toBe("image");
    expect(normalizeFormImportDraft({ fields: [] }, "foto.jpg", "image")).toBeNull();
  });
});
