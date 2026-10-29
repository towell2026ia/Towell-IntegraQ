import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
import { PasswordAccessScreen } from "./password-access-screen";

beforeEach(() => {
  mocks.createClient.mockReset();
  mocks.createClient.mockImplementation(() => { throw new Error("Falta configurar Supabase en .env.local."); });
});
describe("password screen prerender without Supabase configuration", () => {
  it("renders the update shell without initializing a client or exposing a password form", () => {
    const html = renderToStaticMarkup(createElement(PasswordAccessScreen, { mode: "update" }));
    expect(html).toContain("Verificando enlace seguro");
    expect(html).not.toContain("Guardar contraseña");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("renders the recovery form without initializing a client", () => {
    const html = renderToStaticMarkup(createElement(PasswordAccessScreen, { mode: "request" }));
    expect(html).toContain("Enviar enlace");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});