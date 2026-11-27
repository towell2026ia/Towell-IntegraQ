import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { GET, POST } from "./route";

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
});
