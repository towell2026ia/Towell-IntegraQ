import { afterEach, describe, expect, it, vi } from "vitest";

import { softDeleteStoredCorrectiveAction } from "@/lib/root-cause-publication";

afterEach(() => vi.unstubAllGlobals());

describe("confirmación de borrado Root2Cause", () => {
  it("no confirma ni oculta un expediente ausente o de otra organización", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "No encontrado" }), { status: 404 })));
    await expect(softDeleteStoredCorrectiveAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Duplicado"))
      .rejects.toThrow(/no pertenece a tu organización/);
  });

  it("confirma sólo después de una respuesta exitosa del servidor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(softDeleteStoredCorrectiveAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Duplicado")).resolves.toBe(true);
  });
});
