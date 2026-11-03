import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error JavaScript helper used only to verify the source layout baseline.
import { files, signature } from "../../scripts/home-layout-signature.mjs";
import baseline from "./home-layout-baseline.json";

describe("Inicio: preservación estática de estructura y estilos", () => {
  for (const path of files as string[]) it(path, () => {
    expect(signature(path, readFileSync(path, "utf8"))).toBe(baseline.hashes[path as keyof typeof baseline.hashes]);
  });
});
