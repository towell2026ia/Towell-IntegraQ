import { describe, expect, it } from "vitest";

import { documentTypeCatalog } from "./document-data";

describe("document type catalog", () => {
  it("keeps controlled formats separate from digital application forms", () => {
    const formats = documentTypeCatalog.find((item) => item.id === "forms");
    const applicationForms = documentTypeCatalog.find(
      (item) => item.id === "application-forms",
    );

    expect(formats?.name).toBe("Formatos");
    expect(applicationForms?.name).toBe("Formularios");
    expect(formats?.code).not.toBe(applicationForms?.code);
  });
});
