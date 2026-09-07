import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "202609070003_data_integrity_relationships.sql"), "utf8");

describe("PRD 02 migration contract", () => {
  it("uses typed foreign keys for the core process relations", () => {
    expect(migration).toContain("create table public.document_processes");
    expect(migration).toContain("create table public.audit_processes");
    expect(migration).toContain("references public.processes(id) on delete restrict");
    expect(migration).toContain("foreign key (corrective_action_id) references public.corrective_actions(id) on delete set null");
    expect(migration).toContain("references public.measurement_assets(id) on delete restrict");
    expect(migration).toContain("source_type in ('customer', 'supplier') and external_organization_id is not null");
  });

  it("preserves Root2Cause, metrology and improvement history", () => {
    expect(migration).toContain("alter table public.corrective_action_a3");
    expect(migration).toContain("equipment_code_snapshot");
    expect(migration).toContain("create table public.improvement_source_links");
  });

  it("reports conflicts without destructive data operations", () => {
    expect(migration).toContain("create table public.migration_conflicts");
    expect(migration).toContain("create table public.migration_report");
    expect(migration).not.toMatch(/\b(drop table|truncate|delete from)\b/i);
  });
});
