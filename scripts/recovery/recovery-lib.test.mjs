import { describe, expect, it } from "vitest";

import { assertRecoveryEnvironment, manifestTotals, parseCliEnv, parseEnv } from "./lib.mjs";

describe("recovery safety guard", () => {
  it("accepts only recovery-local on loopback", () => {
    expect(() => assertRecoveryEnvironment({ APP_ENV: "recovery-local", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).not.toThrow();
    expect(() => assertRecoveryEnvironment({ APP_ENV: "recovery-local", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" })).not.toThrow();
  });

  it("rejects production and missing recovery mode", () => {
    expect(() => assertRecoveryEnvironment({ APP_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toThrow(/APP_ENV/);
    expect(() => assertRecoveryEnvironment({ APP_ENV: "recovery-local", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" })).toThrow(/host rechazado/);
  });
});

describe("recovery parsing", () => {
  it("parses dotenv and Supabase CLI output", () => {
    expect(parseEnv("A=one\nB=\"two\"\n# C=three")).toEqual({ A: "one", B: "two" });
    expect(parseCliEnv('API_URL="http://127.0.0.1:54321"\nANON_KEY="secret"')).toEqual({ API_URL: "http://127.0.0.1:54321", ANON_KEY: "secret" });
  });

  it("totals manifest values", () => {
    expect(manifestTotals({ tables: { one: 2, two: 3 }, authUsers: 4, storage: { files: 5, bytes: 6 }, warnings: [] })).toEqual({ tables: 2, rows: 5, users: 4, files: 5, bytes: 6, warnings: 0 });
  });
});
