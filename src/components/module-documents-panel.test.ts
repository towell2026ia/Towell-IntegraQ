import { describe, expect, it } from "vitest";

import { shouldRenderModuleDocuments } from "@/components/module-documents-panel";

describe("module documents panel visibility", () => {
  it("does not render a document repository on Home", () => {
    expect(shouldRenderModuleDocuments("home")).toBe(false);
  });

  it("preserves the reusable document panel for other modules", () => {
    expect(shouldRenderModuleDocuments("documents")).toBe(true);
    expect(shouldRenderModuleDocuments("risks")).toBe(true);
  });
});
