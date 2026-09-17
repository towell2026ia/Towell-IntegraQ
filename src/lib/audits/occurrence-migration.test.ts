import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202609140001_audit_occurrences.sql"),
  "utf8",
);

describe("AUD-PRD-01 migration contract", () => {
  it("separates historical series from real occurrences", () => {
    expect(migration).toContain("create table public.audit_series");
    expect(migration).toContain("add column if not exists audit_series_id");
    expect(migration).not.toContain("create table public.audits");
  });

  it("supports all schedule modes and notice-only recurrence rules", () => {
    expect(migration).toContain("schedule_type in ('exact', 'range', 'window', 'pending')");
    expect(migration).toContain("origin_type <> 'notice' or recurrence_mode = 'no'");
    expect(migration).toContain("audit_type <> 'customer' or origin_type = 'notice'");
  });

  it("keeps audit records and changes traceable", () => {
    expect(migration).toContain("public.next_audit_code");
    expect(migration).toContain("public.trace_audit_occurrence_change");
    expect(migration).toContain("revoke delete on public.audits from authenticated");
    expect(migration).not.toMatch(/\b(drop table|truncate|delete from public\.audits)\b/i);
  });
});
