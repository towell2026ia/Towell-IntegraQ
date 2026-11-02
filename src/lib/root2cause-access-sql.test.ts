import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261102190001_root2cause_admin_writes.sql", "utf8").toLowerCase();

describe("proposed Root2Cause RLS restriction", () => {
  it("limits only write commands while preserving existing SELECT policies", () => {
    for (const table of ["corrective_actions", "corrective_action_a3", "corrective_action_plans",
      "corrective_action_participants", "corrective_action_effectiveness_reviews", "file_objects"]) {
      for (const command of ["insert", "update", "delete"]) {
        expect(sql).toMatch(new RegExp(`on public\\.${table}\\s+as restrictive for ${command} to authenticated`));
      }
    }
    expect(sql).not.toMatch(/\bfor (select|all) to authenticated\b/);
    expect(sql).not.toMatch(/\b(drop|truncate|delete from|update public\.|insert into)\b/);
    expect(sql).toContain("security invoker");
    expect(sql).toContain("public.is_administrator()");
    expect(sql).toContain("p.organization_id = corrective_actions.organization_id");
  });
});
