import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("indicator capture permissions in the database", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/202610070002_indicator_capture_permissions.sql"),
    "utf8",
  );

  it("separates indicator capture from document roles", () => {
    expect(migration).toContain("public.has_process_access(relation.process_id)");
    expect(migration).toContain("public.has_module_permission('indicators', 'update')");
    expect(migration).not.toContain("has_process_document_role");
  });

  it("enforces process, functional permission and window for direct writes", () => {
    expect(migration).toContain("create policy indicator_results_insert_window");
    expect(migration).toContain("create policy indicator_results_update_window");
    expect(migration).toContain("now() between period.opens_at and period.closes_at");
    expect(migration).toContain("INDICATOR_PROCESS_FORBIDDEN");
    expect(migration).toContain("INDICATOR_CAPTURE_PERMISSION_REQUIRED");
    expect(migration).toContain("INDICATOR_CAPTURE_WINDOW_CLOSED");
  });

  it("uses the same functional authorization for indicator evidence", () => {
    expect(migration).toContain("public.can_capture_indicator_evidence(resource_key, process_id)");
    expect(migration).toContain("resource_type = 'indicator_result'");
  });
});
