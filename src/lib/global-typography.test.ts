import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("global typography coverage", () => {
  it("scales fixed font sizes in shared modules and the document catalog", () => {
    for (const file of ["src/app/globals.css", "src/components/modules/general-information.module.css"]) {
      const css = readFileSync(join(process.cwd(), file), "utf8");
      expect(css).not.toMatch(/font-size:\s*\d+(?:\.\d+)?px\b/);
      expect(css).toContain("var(--app-text-scale, 1)");
    }
  });
  it("keeps existing Inicio sizing independent of browser zoom", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain("var(--home-text-scale, 1)");
    expect(css).not.toContain("zoom:");
  });
});
