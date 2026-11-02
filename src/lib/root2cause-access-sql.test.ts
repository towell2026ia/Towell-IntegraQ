import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261102190001_root2cause_admin_writes.sql", "utf8").toLowerCase();
const portalSql = readFileSync("supabase/migrations/202609240002_transversal_evidence_permissions.sql", "utf8").toLowerCase();

describe("proposed Root2Cause RLS restriction", () => {
  it("limits writes and preserves the existing permissive SELECT policies", () => {
    for (const table of ["corrective_actions", "corrective_action_a3", "corrective_action_plans",
      "corrective_action_participants", "corrective_action_effectiveness_reviews", "file_objects"]) {
      for (const command of ["insert", "update", "delete"]) {
        expect(sql).toMatch(new RegExp(`on public\\.${table}\\s+as restrictive for ${command} to authenticated`));
      }
    }
    expect(sql).not.toMatch(/\bfor all to authenticated\b/);
    expect(sql).not.toMatch(/\b(drop|truncate|delete from|update public\.|insert into)\b/);
    expect(sql).toContain("security invoker");
    expect(sql).toContain("public.is_administrator()");
    expect(sql).toContain("p.organization_id = corrective_actions.organization_id");
  });

  it("keeps the customer portal scoped and blocks external Root2Cause file metadata", () => {
    const portalAccess = portalSql.split("create or replace function public.can_access_corrective_action(requested_action_id uuid)")[1]
      .split("$$;")[0];
    expect(portalAccess).toContain("action.source = 'customer'");
    expect(portalAccess).toContain("action.portal_visible");
    expect(portalAccess).toContain("has_external_organization_scope('customer', action.external_organization_id)");
    expect(portalAccess).toContain("has_permission('portal_clientes.acceder'");
    expect(sql).toMatch(/on public\.file_objects\s+as restrictive for select to authenticated/);
    expect(sql).toContain("then public.is_administrator() or public.is_internal_user()");
    expect(sql).toContain("else true");
  });
});
