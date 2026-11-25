import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const sql=readFileSync("docs/database/proposals/IQ-PROV-RNCP-FLUJO-FINAL.sql","utf8");
describe("proposed SQL contract only (not database execution)",()=>{
 it("serializes allocation and preserves all prior folios including retired rows",()=>{expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('integraq:rncp:official-folio',0))");expect(sql).toContain("where r.folio ~ '^RNCP[0-9]+$'");expect(sql).toContain("RNCP_FOLIO_IMMUTABLE");});
 it("locks only the actor organization and preserves old purchase orders under that lock",()=>{expect(sql).toContain("where id = requested_report_id and organization_id = actor_org for update");expect(sql).toContain("purchase_order = current_report.purchase_order");expect(sql).not.toContain("requested_payload->>'purchaseOrder'");});
 it("protects explicit classification, historical source and reviewed closure",()=>{expect(sql).toContain("RNCP_CLASSIFICATION_REQUIRED");expect(sql).toContain("RNCP_HISTORICAL_IMMUTABLE");expect(sql).toContain("RNCP_INSPECTOR_VALIDATION_REQUIRED");expect(sql).toContain("to_jsonb(current_report)");expect(sql).toContain("to_jsonb(saved_report)");});
 it("requires unchanged document snapshots and protected backend attestations",()=>{expect(sql).toContain("p_fingerprint is distinct from snap->>'fingerprint'");expect(sql).toContain("obj.user_metadata @>");expect(sql).toContain("obj.metadata->>'size'");expect(sql).toContain("rncp_original_storage_guard");});
 it("confirms manual communication against the registered report and exact current private PDF",()=>{
  const manual = sql.slice(sql.indexOf("if p_command='record_manual_notification'"),sql.indexOf("elsif p_command='submit_delivery'"));
  for (const constraint of ["r.status is distinct from 'submitted'","public.iq_rncp_pdf_snapshot(r.id)","f.resource_id=r.id","f.workspace_id=org","f.is_current","f.version=(p_payload->>'officialVersion')","'generated:'||revision_key","f.created_at <=","'officialSha256',official.sha256","interval '7 days'"]) expect(manual).toContain(constraint);
  expect(sql).toContain("|| proof");
  expect(sql.slice(sql.indexOf("create function public.iq_rncp_register_generated_pdf"),sql.indexOf("-- Runs after"))).not.toMatch(/set notified_at\s*=/);
 });
 it("rejects single-dollar delimiters in SQL function and anonymous block definitions throughout the release",()=>{
  const bundle = readFileSync("docs/database/proposals/IQ-PROV-U07-R2.sql", "utf8");
  const invalidDelimiter = /(?:\b(?:as|do|end)[ \t]+|^[ \t]*)\$;?[ \t]*\r?$/im;
  expect(bundle).not.toMatch(invalidDelimiter);
 });
 it("ships the eight reviewed contracts in dependency order and one transaction",()=>{
  const bundle=readFileSync("docs/database/proposals/IQ-PROV-U07-R2.sql","utf8").replace(/\r\n/g,"\n");
  const contracts=["CONTACTOS-LEGACY-GUARD","CONTACTOS-MULTIPLES","MEJORAS-02-audit-withdrawal","AUDITORIAS-MANUALES","MEJORAS-02-initial-photos","RNCP-PHOTO-KEY","RNCP-AUDIT-SECURITY","RNCP-FLUJO-FINAL"];
  const sections=bundle.split(/^-- IQ-PROV-[^\n]+\n/gm);
  expect(sections).toHaveLength(contracts.length+1);
  expect(bundle.match(/^BEGIN;$/gim)).toHaveLength(1);
  expect(bundle.match(/^COMMIT;$/gim)).toHaveLength(1);
  for(const [index,name] of contracts.entries()){
    const source=readFileSync("docs/database/proposals/IQ-PROV-"+name+".sql","utf8").replace(/\r\n/g,"\n");
    const body=source.slice(source.search(/^begin;[ \t]*$/im)).replace(/^begin;[ \t]*/i,"").replace(/^commit;[ \t]*$/im,"").trim();
    expect(sections[index+1].replace(/^COMMIT;$/gm,"").trim()).toBe(body);
  }
 });
 it("has no deletion, migration repair, historical backfill or automatic dispatch",()=>{expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s/i);expect(sql).not.toContain("supplier_rncp_notification_outbox");expect(sql).toContain("begin;");expect(sql.trim().endsWith("commit;")).toBe(true);});
});
