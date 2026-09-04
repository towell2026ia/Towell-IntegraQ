import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import { POST } from "./route";

describe("organization import API", () => {
  beforeEach(() => getUser.mockResolvedValue({ data: { user: { id: "user-1" } } }));

  it("interprets an xlsx hierarchy including level five", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Organigrama");
    sheet.addRow(["Puesto", "Nivel", "Reporta a", "Área"]);
    sheet.addRow(["Jefe de Tejido", 4, "Gerencia de Costura", "Tejido"]);
    sheet.addRow(["Supervisor de Producción", 5, "Jefe de Tejido", "Tejido"]);
    const bytes = await workbook.xlsx.writeBuffer();
    const body = new FormData();
    body.set("processName", "Tejido");
    body.set("file", new File([Uint8Array.from(bytes as unknown as Uint8Array)], "organigrama.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const response = await POST(new Request("http://localhost/api/ai/organization-import", { method: "POST", body }));
    const payload = await response.json() as { draft: OrganizationChartDraft };
    expect(response.status).toBe(200);
    expect(payload.draft.positions.at(-1)).toMatchObject({ name: "Supervisor de Producción", level: 5 });
  });

  it("requires authentication", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    const response = await POST(new Request("http://localhost/api/ai/organization-import", { method: "POST" }));
    expect(response.status).toBe(401);
  });
});

type OrganizationChartDraft = import("@/lib/organization-chart-data").OrganizationChartDraft;
