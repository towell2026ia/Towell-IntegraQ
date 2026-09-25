import { describe, expect, it } from "vitest";

import { assertRecoverySupabaseUrl } from "./recovery-guard";

describe("assertRecoverySupabaseUrl", () => {
  it("allows loopback targets in recovery", () => {
    expect(() => assertRecoverySupabaseUrl("http://127.0.0.1:54321", "recovery-local")).not.toThrow();
    expect(() => assertRecoverySupabaseUrl("http://localhost:54321", "recovery-local")).not.toThrow();
  });

  it("blocks cloud and invalid targets in recovery", () => {
    expect(() => assertRecoverySupabaseUrl("https://project.supabase.co", "recovery-local")).toThrow(/NON_LOCAL/);
    expect(() => assertRecoverySupabaseUrl("not-a-url", "recovery-local")).toThrow(/INVALID/);
  });

  it("does not alter normal environments", () => {
    expect(() => assertRecoverySupabaseUrl("https://project.supabase.co", "production")).not.toThrow();
  });
});
