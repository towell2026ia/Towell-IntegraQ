import { describe, expect, it } from "vitest";

import { shouldRenderModuleDocuments } from "@/components/module-documents-panel";

describe("module documents panel visibility", () => {
  it("does not render a document repository on Home", () => {
    expect(shouldRenderModuleDocuments("home")).toBe(false);
  });

  it("uses the dedicated repository for Información Documentada", () => {
    expect(shouldRenderModuleDocuments("documents")).toBe(false);
  });

  it("preserves the reusable document panel for other modules", () => {
    expect(shouldRenderModuleDocuments("risks")).toBe(true);
  });
});
