import { describe, expect, it } from "vitest";

import { normalizePositionName } from "./organization-position-data";

describe("organization position data", () => {
  it("stores new position names in lowercase and removes repeated spaces", () => {
    expect(normalizePositionName("  SUPERVISOR   DE PRODUCCIÓN  ")).toBe("supervisor de producción");
    expect(normalizePositionName("Auditor de Calidad")).toBe("auditor de calidad");
  });
});

