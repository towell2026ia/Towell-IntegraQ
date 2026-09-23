import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202609220001_document_lifecycle_master_list.sql"),
  "utf8",
);

describe("ID-PRD-UPDATE-01 migration contract", () => {
  it("extends the live document model without recreating its primary table", () => {
    expect(migration).toContain("create table if not exists public.document_lifecycle");
    expect(migration).toContain("create table if not exists public.document_audit_log");
    expect(migration).toContain("create or replace view public.v_document_master_list");
    expect(migration).not.toContain("create table public.controlled_documents");
    expect(migration).not.toMatch(/\b(truncate|drop table|delete from public\.controlled_documents)\b/i);
  });

  it("protects versions and implements lifecycle actions through permission-checked RPCs", () => {
    expect(migration).toContain("on delete restrict");
    expect(migration).not.toContain("on delete cascade");
    expect(migration).toContain("create or replace function public.create_document_version");
    expect(migration).toContain("create or replace function public.obsolete_document");
    expect(migration).toContain("create or replace function public.soft_delete_document");
    expect(migration).toContain("create or replace function public.restore_document");
    expect(migration).toContain("public.assert_document_permission");
    expect(migration).toContain("enable row level security");
  });

  it("backfills lifecycle idempotently and preserves one current version", () => {
    expect(migration).toContain("on conflict (document_id) do nothing");
    expect(migration).toContain("controlled_document_current_version_idx");
  });
});
