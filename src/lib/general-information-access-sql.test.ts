import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guard = readFileSync("supabase/migrations/20261102200001_general_information_external_read_guard.sql", "utf8").toLowerCase();
const adminDeletion = readFileSync("supabase/migrations/20261102170852_admin_delete_guard.sql", "utf8").toLowerCase();
const root2cause = readFileSync("supabase/migrations/20261102190001_root2cause_admin_writes.sql", "utf8").toLowerCase();

describe("proposed General Information external read guard", () => {
  it("requires an active internal profile in the requested workspace for folder and file RLS", () => {
    const scope = guard.split("create or replace function public.can_access_general_information_workspace")[1].split("$check$;")[0];
    expect(scope).toContain("profile.status = 'active'");
    expect(scope).toContain("profile.user_type in ('administrator', 'internal')");
    expect(scope).toContain("profile.organization_id = requested_workspace_id");
    expect(scope).not.toContain("'customer'");
    expect(scope).not.toContain("'supplier'");
    expect(guard).toMatch(/on public\.document_folders\s+as restrictive for select to authenticated/);
    expect(guard).toMatch(/on public\.file_objects\s+as restrictive for select to authenticated/);
    expect(guard).toContain("resource_type is distinct from 'general_information_document'");
  });

  it("guards direct Storage reads, including previews, while preserving other files", () => {
    expect(guard).toContain("file.object_path = requested_path or file.preview_path = requested_path");
    expect(guard).toContain("file.resource_type = 'general_information_document'");
    expect(guard).toContain("public.is_administrator() or public.is_internal_user()");
    expect(guard).toMatch(/on storage\.objects\s+as restrictive for select to authenticated/);
    expect(guard).toContain("security definer set search_path = ''");
    expect(guard).toContain("revoke all on function public.iq_general_information_storage_read_allowed(text, text) from public");
    expect(guard).toContain("grant execute on function public.iq_general_information_storage_read_allowed(text, text) to authenticated");
  });

  it("adds no destructive statements or policy name collisions with PR #19 and Root2Cause", () => {
    expect(guard).not.toMatch(/\b(drop|truncate|delete from|update public\.|insert into|alter table)\b/);
    for (const policy of ["iq_general_information_internal_folders_select", "iq_general_information_internal_files_select",
      "iq_general_information_internal_storage_select"]) {
      expect(adminDeletion).not.toContain(policy);
      expect(root2cause).not.toContain(policy);
    }
  });
});
