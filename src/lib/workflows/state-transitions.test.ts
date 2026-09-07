import { describe, expect, it } from "vitest";

import { validateStateTransition } from "./state-transitions";

describe("state transitions", () => {
  it("accepts valid transitions and blocks arbitrary jumps", () => {
    expect(validateStateTransition("document", "draft", "submitted")).toBe(true);
    expect(() => validateStateTransition("document", "draft", "published")).toThrow(/No se permite/);
    expect(validateStateTransition("corrective_action", "closed", "effectiveness_review")).toBe(true);
  });
});
