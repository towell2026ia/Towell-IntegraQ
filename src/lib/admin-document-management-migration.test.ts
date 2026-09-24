import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/202609240005_admin_only_document_management.sql"),
  "utf8",
);

describe("administrator-only document management migration", () => {
  it("protects file metadata and private storage mutations with administrator RLS", () => {
    expect(migration).toContain("create policy file_objects_insert_admin");
    expect(migration).toContain("create policy file_objects_update_admin");
    expect(migration).toContain("create policy integraq_storage_insert_admin");
    expect(migration).toContain("public.is_administrator()");
  });

  it("protects controlled document and version mutations", () => {
    expect(migration).toContain("create policy controlled_documents_insert_admin");
    expect(migration).toContain("create policy controlled_documents_update_admin");
    expect(migration).toContain("create policy document_versions_insert_admin");
    expect(migration).toContain("create policy document_versions_update_admin");
    expect(migration).toContain("administrator_only := requested_permission in");
  });

  it("removes legacy mutation grants from non-administrator assignments", () => {
    expect(migration).toContain("role.code <> 'ADMIN'");
    expect(migration).toContain("delete from public.user_permission_overrides");
    expect(migration).toContain("'evidencias.agregar'");
    expect(migration).toContain("'documents.version'");
  });
});
