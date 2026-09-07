import { describe, expect, it } from "vitest";

import { createFingerprint, logAiActivity, MemoryAiActivitySink, sanitizeAuditMetadata } from ".";

describe("AI audit", () => {
  it("creates deterministic fingerprints that change with the input", () => {
    expect(createFingerprint({ b: 2, a: 1 })).toBe(createFingerprint({ a: 1, b: 2 }));
    expect(createFingerprint({ a: 1 })).not.toBe(createFingerprint({ a: 2 }));
  });

  it("creates an event without storing secrets", async () => {
    const sink = new MemoryAiActivitySink();
    await logAiActivity(sink, { requestId: "req-1", userId: "u-1", module: "risks", capability: "risks.evaluate", inputFingerprint: createFingerprint({ risk: 1 }), contextFingerprint: createFingerprint({ process: "P-08" }), status: "disabled", responseType: "error", requiresApproval: false, metadata: { apiKey: "secret", nested: { password: "hidden", safe: true } } });
    expect(sink.events).toHaveLength(1);
    expect(JSON.stringify(sink.events[0])).not.toContain("secret");
    expect(JSON.stringify(sanitizeAuditMetadata({ token: "x", safe: "yes" }))).toBe('{"safe":"yes"}');
  });
});

