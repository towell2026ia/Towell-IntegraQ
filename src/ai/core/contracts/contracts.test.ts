import { describe, expect, it } from "vitest";

import { createAiErrorResponse, isIntegraQAiResponse, validateIntegraQAiRequest } from ".";

describe("IntegraQ AI contracts", () => {
  it("accepts a valid selective-context request", () => {
    const result = validateIntegraQAiRequest({ requestId: "req-1", task: "suggest", module: "risks", action: "evaluate", context: { include: ["process", "documents"] }, input: {}, metadata: {} });
    expect(result.valid).toBe(true);
  });

  it("rejects invalid modules and context sources", () => {
    const result = validateIntegraQAiRequest({ requestId: "req-2", task: "suggest", module: "unknown", action: "evaluate", context: { include: ["secrets"] }, input: {}, metadata: {} });
    expect(result.valid).toBe(false);
  });

  it("creates a valid controlled response", () => {
    expect(isIntegraQAiResponse(createAiErrorResponse({ requestId: "req-3", status: "disabled", code: "CAPABILITY_DISABLED", message: "No habilitada." }))).toBe(true);
  });
});

