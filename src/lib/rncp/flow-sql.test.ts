import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const sql=readFileSync("docs/database/proposals/IQ-PROV-RNCP-FLUJO-FINAL.sql","utf8");
describe("proposed SQL contract only (not database execution)",()=>{
 it("serializes allocation and preserves all prior folios including retired rows",()=>{expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('integraq:rncp:official-folio',0))");expect(sql).toContain("where r.folio ~ '^RNCP[0-9]+$'");expect(sql).toContain("RNCP_FOLIO_IMMUTABLE");});
 it("locks only the actor organization and preserves old purchase orders under that lock",()=>{expect(sql).toContain("where id = requested_report_id and organization_id = actor_org for update");expect(sql).toContain("purchase_order = current_report.purchase_order");expect(sql).not.toContain("requested_payload->>'purchaseOrder'");});
 it("protects explicit classification, historical source and reviewed closure",()=>{expect(sql).toContain("RNCP_CLASSIFICATION_REQUIRED");expect(sql).toContain("RNCP_HISTORICAL_IMMUTABLE");expect(sql).toContain("RNCP_INSPECTOR_VALIDATION_REQUIRED");expect(sql).toContain("to_jsonb(current_report)");expect(sql).toContain("to_jsonb(saved_report)");});
 it("requires unchanged document snapshots and protected backend attestations",()=>{expect(sql).toContain("p_fingerprint is distinct from snap->>'fingerprint'");expect(sql).toContain("obj.user_metadata @>");expect(sql).toContain("obj.metadata->>'size'");expect(sql).toContain("rncp_original_storage_guard");});
 it("has no deletion, migration repair, historical backfill or automatic dispatch",()=>{expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s/i);expect(sql).not.toContain("supplier_rncp_notification_outbox");expect(sql).toContain("begin;");expect(sql.trim().endsWith("commit;")).toBe(true);});
});
