import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, getUser, update, eq, eqProcess, eqResource, is, select, maybeSingle } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  eqProcess: vi.fn(),
  eqResource: vi.fn(),
  is: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient }));

import { deleteProcessOrganizationChart } from "./organization-chart-storage";

const source = {
  id: "file-id",
  processId: "P-08",
  fileName: "organigrama.png",
  mimeType: "image/png",
  createdAt: "2026-10-20T12:00:00.000Z",
  interpretedCount: 0,
  bucketId: "integraq-private",
  objectPath: "process/chart.png",
  sizeBytes: 100,
  version: 2,
};

describe("organization chart retirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "admin-user" } }, error: null });
    maybeSingle.mockResolvedValue({ data: { id: "file-id" }, error: null });
    createClient.mockReturnValue({
      auth: { getUser },
      from: vi.fn(() => ({ update })),
    });
    update.mockReturnValue({ eq });
    eq.mockReturnValue({ eq: eqProcess });
    eqProcess.mockReturnValue({ eq: eqResource });
    eqResource.mockReturnValue({ is });
    is.mockReturnValue({ select });
    select.mockReturnValue({ maybeSingle });
  });

  it("requires a non-empty reason before contacting Supabase", async () => {
    await expect(deleteProcessOrganizationChart(source, "  ")).rejects.toThrow("motivo");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("soft-retires only the matching current file with actor, timestamp and reason", async () => {
    await deleteProcessOrganizationChart(source, "Archivo sustituido por versión vigente");

    expect(getUser).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      is_current: false,
      deleted_by: "admin-user",
      deletion_reason: "Archivo sustituido por versión vigente",
      deleted_at: expect.any(String),
    }));
    expect(eq).toHaveBeenNthCalledWith(1, "id", source.id);
    expect(eqProcess).toHaveBeenCalledWith("process_id", source.processId);
    expect(eqResource).toHaveBeenCalledWith("resource_type", "process_organization_chart");
    expect(is).toHaveBeenCalledWith("deleted_at", null);
    expect(select).toHaveBeenCalledWith("id");
    expect(maybeSingle).toHaveBeenCalledOnce();
  });

  it("reports when the server did not confirm a matching file", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(deleteProcessOrganizationChart(source, "Retiro autorizado")).rejects.toThrow("no confirmó");
  });
});
