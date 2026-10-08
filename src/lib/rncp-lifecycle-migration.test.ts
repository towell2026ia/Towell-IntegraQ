import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/202610080003_rncp_lifecycle.sql"), "utf8").toLocaleLowerCase();
const moduleSource = readFileSync(join(process.cwd(), "src/components/modules/suppliers-module.tsx"), "utf8");

describe("RNCP lifecycle contract", () => {
  it("uses base lifecycle states and derives lateness", () => {
    expect(migration).toContain("status in ('draft', 'submitted', 'in_progress', 'closed')");
    expect(migration).toContain("response_due_date < current_date");
    expect(migration).not.toContain("status = 'late'");
  });

  it("enforces soft delete and administrator-only restoration", () => {
    expect(migration).toContain("add column deleted_at timestamptz");
    expect(migration).toContain("add column deleted_by uuid");
    expect(migration).toContain("add column delete_reason text");
    expect(migration).toContain("if not public.is_administrator()");
    expect(migration).not.toContain("delete from public.supplier_rncp_reports");
  });

  it("records the required lifecycle events", () => {
    for (const action of ["rncp.created", "rncp.draft_saved", "rncp.submitted", "rncp.assigned", "rncp.action_added", "rncp.evidence_added", "rncp.closed", "rncp.reopened", "rncp.deleted", "rncp.restored"]) {
      expect(migration).toContain(action);
    }
  });

  it("shows independent draft and submit actions plus history", () => {
    expect(moduleSource).toContain("Guardar borrador");
    expect(moduleSource).toContain("Enviar RNCP");
    expect(moduleSource).toContain("Historial");
    expect(moduleSource).toContain("Tardías");
    expect(moduleSource).not.toContain("Supabase");
  });
});
