import { describe, expect, it } from "vitest";

import {
  accessRuleCatalog,
  permissionAreaCatalog,
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
});
