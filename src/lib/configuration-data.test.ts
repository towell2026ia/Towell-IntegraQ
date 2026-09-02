import { describe, expect, it } from "vitest";

import {
  accessRuleCatalog,
  permissionAreaCatalog,
  processCatalog,
  userTypeCatalog,
} from "@/lib/configuration-data";

describe("user and access matrix", () => {
  it("defines the four approved user types", () => {
    expect(userTypeCatalog.map((item) => item.name)).toEqual([
      "Administrador",
      "Usuario interno",
      "Cliente",
      "Proveedor",
    ]);
  });

  it("preserves the complete permission matrix and security rules", () => {
    expect(permissionAreaCatalog).toHaveLength(28);
    expect(accessRuleCatalog).toHaveLength(18);
  });

  it("uses the confirmed P-11 Recursos Humanos name", () => {
    expect(processCatalog.find((process) => process.id === "P-11")?.name).toBe(
      "Recursos Humanos",
    );
  });

  it("includes P-35 Sistemas de Gestión de Calidad", () => {
    expect(processCatalog.find((process) => process.id === "P-35")).toMatchObject({
      name: "Sistemas de Gestión de Calidad",
      level: "process",
    });
  });
});
