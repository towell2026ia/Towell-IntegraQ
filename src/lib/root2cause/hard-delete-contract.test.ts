import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("docs/database/proposals/IQ-ROOT2CAUSE-HARD-DELETE.sql", "utf8");

describe("Root2Cause definitive-delete SQL proposal", () => {
  it("keeps itself a proposal and limits the added state to resumable deletion and folio reservation", () => {
    expect(sql).toContain("PROPOSAL ONLY");
    expect(sql).toContain("root2cause_hard_delete_operations");
    expect(sql).toContain("root2cause_action_folio_counter");
    expect(sql).not.toMatch(/\b(drop\s+table|truncate\s+table)\b/i);
  });

  it("requires an administrator with an explicit manage permission on every RPC", () => {
    expect(sql.match(/user_type\s*=\s*'administrator'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("permission.action = 'manage'");
    expect(sql).toContain("EXPLICIT_DELETE_PERMISSION_REQUIRED");
    expect(sql.match(/permission\.source\s*=\s*'direct'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("revoke all on public.root2cause_hard_delete_operations from public, anon, authenticated");
  });

  it("limits finalization to the backend role and verifies Storage absence inside PostgreSQL", () => {
    expect(sql).toContain("iq_root2cause_hard_delete_complete(p_operation_id uuid,p_actor_id uuid)");
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("revoke all on function public.iq_root2cause_hard_delete_complete(uuid) from public,anon,authenticated,service_role");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("operation.actor_id is distinct from actor.id");
    expect(sql).toContain("ROOT2CAUSE_STORAGE_OBJECTS_REMAIN");
    expect(sql).toContain("from storage.objects stored_object");
    expect(sql).toContain("set_config('app.root2cause_hard_delete_actor',actor.id::text,true)");
    expect(sql).toContain("op.actor_id = operation_actor_id");
    expect(sql).toContain("iq_root2cause_evidence_delete_pending");
    expect(sql).toContain("root2cause_hard_delete_evidence_insert_guard");
    expect(sql).toContain("root2cause_hard_delete_storage_insert_guard");
    expect(sql).toContain("ROOT2CAUSE_DELETE_IN_PROGRESS");
  });

  it("fails closed on external references and verifies private Root2Cause object ownership", () => {
    expect(sql).toContain("ACTION_REFERENCED_BY_OTHER_MODULE");
    expect(sql).toContain("FILE_REFERENCED_OUTSIDE_ACTION");
    expect(sql).toContain("bucket_id <> 'integraq-private'");
    expect(sql).toContain("ROOT2CAUSE_EVIDENCE_PATH_UNVERIFIED");
    expect(sql).toContain("Storage removal");
  });

  it("preserves only a minimal immutable tombstone and reserves deleted AC codes", () => {
    expect(sql).toContain("root2cause.action_deleted");
    expect(sql).toContain("root2cause.action_delete_started");
    expect(sql).toContain("root2cause.action_delete_storage_incomplete");
    expect(sql).toContain("entity_code_snapshot");
    expect(sql).toContain("iq_root2cause_allocate_action_folio");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("action_folio");
    expect(sql).toContain("draft is null or draft->>'evidenceId'");
    expect(sql).toContain("root2cause_action_folio_reservations");
    expect(sql).toContain("select op.action_folio from public.root2cause_hard_delete_operations op");
    expect(sql).toContain("select log.entity_code_snapshot from public.audit_log log where log.action='root2cause.action_deleted'");
  });

  it("keeps the shared workspace audit behavior for every non-delete operation", () => {
    expect(sql).toContain("new.area in ('correctiveActions','a3Draft')");
    expect(sql).toContain("op.actor_id = operation_actor_id and op.status = 'storage_pending'");
    expect(sql).toContain("audit_action := case");
    expect(sql).toContain("old.payload else null end, new.payload");
    expect(sql).toContain("'workspace_data', new.id::text");
  });

  it("keeps unrelated workspace changes available while protecting the pending target", () => {
    expect(sql).toContain("ROOT2CAUSE_HARD_DELETE_TARGET_IN_PROGRESS");
    expect(sql).not.toContain("ROOT2CAUSE_HARD_DELETE_IN_PROGRESS");
    expect(sql).toContain("ROOT2CAUSE_CHILD_REFERENCED_EXTERNALLY");
    expect(sql).toContain("ROOT2CAUSE_EVIDENCE_SHARED");
    expect(sql).toContain("ROOT2CAUSE_DRAFT_REFERENCED_EXTERNALLY");
    expect(sql).toContain("DUPLICATE_ACTION_ID_OR_FOLIO");
    expect(sql).toContain("RELATIONAL_ACTION_SCOPE_MISMATCH");
  });
});
