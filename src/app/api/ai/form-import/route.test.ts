import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("form import API", () => {
  it("reads a real XLSX workbook and returns an editable draft", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Registro");
    sheet.addRow(["Towell", "F-PR-18"]);
    sheet.addRow(["Registro de liberación de producto"]);
    sheet.addRow([]);
    sheet.addRow(["Fecha", "Lote", "Cantidad", "Resultado", "Observaciones"]);
    sheet.addRow(["2026-08-17", "L-100", 20, "Conforme", "Liberado"]);
    const binary = await workbook.xlsx.writeBuffer();
    const file = new File(
      [Uint8Array.from(binary as unknown as Uint8Array)],
      "F-PR-18.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    );
    const formData = new FormData();
    formData.set("file", file);

    const response = await POST(
      new Request("http://localhost/api/ai/form-import", {
        method: "POST",
        body: formData,
      }),
    );
    const payload = (await response.json()) as {
      draft: { registrationNumber: string; fields: Array<{ label: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.draft.registrationNumber).toBe("F-PR-18");
    expect(payload.draft.fields.map((field) => field.label)).toContain("Resultado");
  });

  it("does not fabricate a photo interpretation when visual AI is unavailable", async () => {
    vi.stubEnv("INTEGRAQ_FORM_IMPORT_AI_ENDPOINT", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const formData = new FormData();
    formData.set(
      "file",
      new File([new Uint8Array([137, 80, 78, 71])], "formulario.png", {
        type: "image/png",
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/ai/form-import", {
        method: "POST",
        body: formData,
      }),
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(payload.error).toContain("requiere configurar");
    vi.unstubAllEnvs();
  });
});
