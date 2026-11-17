import {readFileSync} from "node:fs";import {createHash} from "node:crypto";import {describe,it,expect} from "vitest";
const sql=readFileSync("docs/database/proposals/IQ-PROV-RNCP-ENVIO.sql","utf8");
describe("mail SQL contract review only; no database execution",()=>{
 it("reuses the outbox without creating tables or rows during installation",()=>{expect(sql).not.toMatch(/create table/i);expect(sql).not.toMatch(/\b(delete from|truncate|drop table)\b/i);expect(sql).toContain("event_type='initial'");});
 it("keeps initial jobs away from the legacy automatic lease/retry path",()=>{expect(sql).toContain("delivery_state='disabled'");expect(sql).toContain("initial_phase not in ('prepared','failed')");expect(sql).toContain("lease_until=null");});
 it("limits attestation to service_role and completion to the authorized user",()=>{expect(sql).toContain("iq_rncp_attest_initial_mail(uuid,uuid,jsonb) from public,anon,authenticated");expect(sql).toContain("job.initial_receipt->>'outcome' is distinct from 'accepted'");expect(sql).toContain("public.iq_rncp_followup_command(r.id,'record_notification'");});
 it("freezes report edits and protects retries with a unique initial job and lease",()=>{expect(sql).toContain("rncp_one_initial_mail");expect(sql).toContain("job.lease_id is distinct from p_lease");expect(sql).toContain("RNCP_MAIL_IN_FLIGHT_RECONCILE_REQUIRED");});
 it("binds recipient, reply-to, sender and the official PDF to explicit confirmation",()=>{for(const field of ['fingerprint','recipient','replyTo','sender'])expect(sql).toContain("p_expected->>'"+field+"'");expect(sql).toContain("resource_key='generated:'||(snap->>'fingerprint')");expect(sql).toContain("recipient_verified_at");});
 it("preserves the already reviewed folio proposal byte for byte",()=>{const prior=readFileSync("docs/database/proposals/IQ-PROV-RNCP-FLUJO-FINAL.sql");expect(createHash("sha256").update(prior).digest("hex")).toBe("9e54250ae7cb6461f2eab428becddd765483a34c79ecad085ff837b0904076e1");});
});
