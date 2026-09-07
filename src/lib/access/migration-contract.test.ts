import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "202609070004_access_traceability_approvals.sql"), "utf8");

describe("PRD 03 migration contract", () => {
  it("evolves the existing access and audit models", () => {
    expect(migration).toContain("create table public.roles");
    expect(migration).toContain("create table public.permissions");
    expect(migration).toContain("create table public.user_roles");
    expect(migration).toContain("alter table public.audit_log");
    expect(migration).not.toContain("create table public.activity_log");
  });
  it("enforces immutable decisions, RLS and soft deletion", () => {
    expect(migration).toContain("create or replace function public.decide_approval");
    expect(migration).toContain("CONFLICT_OF_INTEREST");
    expect(migration).toContain("REASON_REQUIRED");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("deleted_at timestamptz");
    expect(migration).not.toMatch(/\b(truncate|drop table|delete from public\.(audit_log|approval_requests))\b/i);
  });
});
