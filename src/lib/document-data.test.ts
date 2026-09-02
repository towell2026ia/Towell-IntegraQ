import { describe, expect, it } from "vitest";

import {
  documentProcessGroups,
  documentTypeCatalog,
  getDocumentProcessIds,
  getPrimaryDocumentProcessId,
  isGroupedDocumentProcess,
} from "./document-data";

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

describe("document process groups", () => {
  it("consolidates the confirmed documentary process folders", () => {
    expect(documentProcessGroups).toEqual([
      { processId: "P-13", memberProcessIds: ["P-14", "P-15", "P-16", "P-19"] },
      { processId: "P-17", memberProcessIds: ["P-18", "P-19", "P-20", "P-21"] },
      { processId: "P-22", memberProcessIds: ["P-23", "P-24", "P-25", "P-26", "P-27"] },
      { processId: "P-34", memberProcessIds: ["P-28", "P-29", "P-30", "P-32", "P-33"] },
    ]);
  });

  it("allows P-19 to be consulted from both documentary groups", () => {
    expect(getDocumentProcessIds("P-13")).toContain("P-19");
    expect(getDocumentProcessIds("P-17")).toContain("P-19");
    expect(getPrimaryDocumentProcessId("P-19")).toBe("P-13");
  });

  it("identifies processes hidden as independent documentary folders", () => {
    expect(isGroupedDocumentProcess("P-18")).toBe(true);
    expect(isGroupedDocumentProcess("P-33")).toBe(true);
    expect(isGroupedDocumentProcess("P-31")).toBe(false);
  });
});
