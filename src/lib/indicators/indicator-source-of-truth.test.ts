import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("indicator source of truth", () => {
  it("does not read or write indicator state through browser storage", () => {
    const sources = [
      "src/hooks/use-indicator-runtime.ts",
      "src/lib/indicators/indicator-repository.ts",
      "src/lib/indicators/indicator-service.ts",
    ].map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");

    expect(sources).not.toContain("localStorage");
    expect(sources).not.toContain("sessionStorage");
    expect(sources).toContain("/api/indicators/runtime");
  });

  it("keeps legacy indicator keys out of workspace hydration and persistence", () => {
    const workspace = readFileSync(
      join(process.cwd(), "src/components/integraq-workspace.tsx"),
      "utf8",
    );

    expect(workspace).not.toContain("integraq.indicatorDefinitions.v2");
    expect(workspace).not.toContain("integraq.indicatorDefinitions.v3");
    expect(workspace).not.toContain("integraq.indicatorResults.v2");
    expect(workspace).not.toContain("integraq.indicatorResults.v3");
    expect(workspace).not.toMatch(/usePersistedArea\([^\n]*indicator/i);
  });

  it("does not expose indicators through the generic workspace repository", () => {
    const genericAreas = readFileSync(join(process.cwd(), "src/lib/workspace-data.ts"), "utf8");

    expect(genericAreas).not.toContain('"indicatorDefinitions"');
    expect(genericAreas).not.toContain('"indicatorResults"');
  });
});
