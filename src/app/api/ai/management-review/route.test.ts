import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession } from "@/lib/session-data";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  ctx: vi.fn(),
  admin: vi.fn(),
  collect: vi.fn(),
  provider: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock(
  "@/lib/supabase/auth-session",
  () => ({ getVerifiedSessionContext: m.ctx }),
);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/review-report-collector", () => ({ collectReview: m.collect }));
vi.mock("openai", () => ({ default: m.provider }));
vi.mock("@/ai/core/legacy-adapter", async (original) => ({
  ...await original<typeof import("@/ai/core/legacy-adapter")>(),
  logLegacyAiRequest: vi.fn(),
}));
import { aiCapabilityRegistry } from "@/ai/core/registry";
import { reportSections } from "@/lib/review-report";
import { GET, POST } from "./route";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const generate = () =>
  POST(
    new Request("https://test.invalid", {
      method: "POST",
      body: JSON.stringify({
        command: "generate",
        year: 2025,
        operation: crypto.randomUUID(),
        accepted: true,
        fingerprint: "x",
      }),
    }),
  );
const read = () =>
  GET(new Request("https://test.invalid?view=sources&year=2025"));
const session = {
  ...activeSession,
  organizationId: "org",
  authUserId: "user",
  workspaceMode: "production",
};
beforeEach(() => {
  vi.resetAllMocks();
  m.rpc.mockResolvedValue({ data: false, error: null });
});
describe("Acceso a la revisión anual", () => {
  it("comprueba autenticación y disponibilidad del verificador", async () => {
    m.ctx.mockResolvedValue(null);
    expect((await generate()).status).toBe(401);
    m.ctx.mockResolvedValue({ failure: "unavailable" });
    expect((await read()).status).toBe(503);
  });
  it.each(["Cliente", "Proveedor", "Usuario interno"])(
    "impide la recopilación y generación a %s",
    async (userType) => {
      m.ctx.mockResolvedValue({
        session: { ...session, userType },
        supabase: { rpc: m.rpc },
      });
      expect((await read()).status).toBe(403);
      expect((await generate()).status).toBe(403);
      expect(m.collect).not.toHaveBeenCalled();
      expect(m.admin).not.toHaveBeenCalled();
    },
  );
  it("bloquea la ruta directa aun con una sesión administradora y presupuesto sin autorizar", async () => {
    m.ctx.mockResolvedValue({
      session: { ...session, userType: "Administrador" },
      supabase: { rpc: m.rpc },
    });
    expect((await generate()).status).toBe(403);
    expect(m.collect).not.toHaveBeenCalled();
    expect(m.provider).not.toHaveBeenCalled();
    const invalid = await POST(
      new Request("https://test.invalid", {
        method: "POST",
        body: JSON.stringify({ context: { metrics: [] } }),
      }),
    );
    expect(invalid.status).toBe(400);
  });
  it("reserva antes de llamar a Responses y conserva esquema, privacidad y tokens", async () => {
    vi.spyOn(aiCapabilityRegistry, "isEnabled").mockReturnValue(true);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    m.ctx.mockResolvedValue({ session: { ...session, userType: "Administrador" }, supabase: { rpc: m.rpc } });
    m.rpc.mockImplementation(async (name) => ({ data: name === "iq_re05_available" }));
    m.collect.mockResolvedValue({ fingerprint: "x", year: 2025, sources: [{ id: "outputs", status: "available", metrics: [], records: [] }], actor: "private-actor" });
    const ledger = vi.fn().mockResolvedValue({ data: { id: "reserved", dispatch: true } });
    m.admin.mockReturnValue({ rpc: ledger });
    const report = { sections: reportSections.map(title => ({ title, text: "Sin registros.", references: ["outputs"] })),
      findings: [], risks: [], recommendations: [], proposals: [], limitations: [], warnings: [] };
    const create = vi.fn().mockResolvedValue({ status: "completed", output: [], output_text: JSON.stringify(report),
      usage: { input_tokens: 42, output_tokens: 77 } });
    m.provider.mockImplementation(function () { return { responses: { create } }; });
    expect((await generate()).status).toBe(200);
    expect(ledger).toHaveBeenCalledWith("iq_re05_reserve", expect.objectContaining({ p_model: "gpt-6-luna" }));
    expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: "gpt-6-luna", store: false,
      instructions: expect.stringContaining("quince apartados"), input: expect.not.stringContaining("private-actor"),
      max_output_tokens: 4000, reasoning: { effort: "medium" },
      text: { format: expect.objectContaining({ name: "informe_anual", type: "json_schema", strict: true }) } }));
    expect(ledger).toHaveBeenCalledWith("iq_re05_finish", expect.objectContaining({ p_state: "completed", p_input: 42, p_output: 77 }));
    ledger.mockResolvedValue({ data: { id: "reserved", state: "completed", dispatch: false } });
    expect((await generate()).status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });

});
