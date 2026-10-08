import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/202610080004_supplier_portal_evidence.sql"), "utf8").toLocaleLowerCase();
const portal = readFileSync(join(process.cwd(), "src/components/modules/stakeholder-portal-module.tsx"), "utf8");
const fileRoute = readFileSync(join(process.cwd(), "src/app/api/suppliers/rncp/evidence/[fileId]/route.ts"), "utf8");

describe("supplier portal evidence contract", () => {
  it("keeps evidence private and returns an expiring signed URL", () => {
    expect(migration).toContain("bucket_id = 'integraq-private'");
    expect(migration).toContain("can_upload_supplier_rncp_evidence");
    expect(fileRoute).toContain("createSignedUrl(record.data.object_path, 120)");
    expect(fileRoute).not.toContain("getPublicUrl");
  });

  it("centralizes size and allowed evidence formats", () => {
    expect(migration).toContain("create table public.file_upload_policies");
    expect(migration).toContain("15728640");
    for (const mime of ["image/jpeg", "image/png", "image/webp", "application/pdf", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]) {
      expect(migration).toContain(mime);
    }
  });

  it("binds evidence to an accessible RNCP action and immutable company scope", () => {
    expect(migration).toContain("action.created_by = auth.uid()");
    expect(migration).toContain("public.can_access_supplier_report(report.id)");
    expect(migration).toContain("external_organization_id = report.supplier_id");
    expect(migration).toContain("external_site_id is not distinct from report.site_id");
    expect(migration).toContain("resource_type not in ('general_information_document', 'supplier_rncp_action_evidence')");
  });

  it("supports camera, files, quality approval and mandatory rejection comments", () => {
    expect(portal).toContain('capture="environment"');
    expect(portal).toContain(".jpg,.jpeg,.png,.webp,.pdf,.xls,.xlsx");
    expect(migration).toContain("rncp.action_validated");
    expect(migration).toContain("rncp.action_rejected");
    expect(migration).toContain("rncp_rejection_comment_required");
  });
});
