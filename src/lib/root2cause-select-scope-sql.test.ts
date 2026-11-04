import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261102210001_root2cause_select_organization_scope.sql", "utf8").toLowerCase();
const pr19 = readFileSync("supabase/migrations/20261102170852_admin_delete_guard.sql", "utf8").toLowerCase();
const pr20Writes = readFileSync("supabase/migrations/20261102190001_root2cause_admin_writes.sql", "utf8").toLowerCase();

describe("proposed Root2Cause SELECT organization scope", () => {
  it("limits parents, children and evidence metadata to an active internal account in the owning organization", () => {
    for (const table of ["corrective_actions", "corrective_action_a3", "corrective_action_plans",
      "corrective_action_participants", "corrective_action_effectiveness_reviews", "file_objects"]) {
      expect(sql).toMatch(new RegExp(`on public\\.${table}\\s+as restrictive for select to authenticated`));
    }
    for (const table of ["corrective_actions", "corrective_action_a3", "corrective_action_plans",
      "corrective_action_participants", "corrective_action_effectiveness_reviews"]) {
      expect(sql).toMatch(new RegExp(`on public\\.${table}\\s+for select to authenticated using \\(public\\.iq_root2cause_action_read_scope`));
    }
    expect(sql).toContain("profile.status = 'active'");
    expect(sql).toContain("profile.user_type in ('administrator', 'internal')");
    expect(sql).toContain("profile.organization_id = action.organization_id");
    expect(sql).toContain("has_module_permission('corrective-actions', 'view')");
    expect(sql).toContain("has_process_access(action.process_id)");
    expect(sql).toContain("resource_id is null");
    expect(sql).toContain("uploaded_by = auth.uid()");
  });

  it("keeps customer portal SELECT separate and protects original and preview objects in Storage", () => {
    expect(sql).toContain("not public.is_internal_user() or public.iq_root2cause_action_read_scope(id)");
    expect(sql).toContain("file.object_path = requested_path or file.preview_path = requested_path");
    expect(sql).toMatch(/on storage\.objects\s+as restrictive for select to authenticated/);
    expect(sql).toContain("revoke all on function public.iq_root2cause_storage_read_allowed(text, text) from public");
    expect(sql).toContain("grant execute on function public.iq_root2cause_storage_read_allowed(text, text) to authenticated");
  });

  it("blocks unverified customer and claim ownership without mutating historical rows", () => {
    expect(pr19).toContain("add column if not exists owning_organization_id uuid");
    expect(pr19).toContain("alter table public.quality_cases add column if not exists organization_id uuid");
    expect(sql).toMatch(/on public\.organizations\s+as restrictive for select to authenticated/);
    expect(sql).toMatch(/on public\.quality_cases\s+as restrictive for select to authenticated/);
    expect(sql).toContain("profile.organization_id = organizations.owning_organization_id");
    expect(sql).toContain("profile.organization_id = quality_cases.organization_id");
    expect(sql).not.toMatch(/\b(drop|truncate|delete from|update public\.|insert into|alter table)\b/);
    for (const policy of ["iq_root2cause_actions_tenant_select", "iq_customer_internal_owner_select",
      "iq_customer_claim_internal_owner_select"]) {
      expect(pr19).not.toContain(policy);
      expect(pr20Writes).not.toContain(policy);
    }
  });
});
