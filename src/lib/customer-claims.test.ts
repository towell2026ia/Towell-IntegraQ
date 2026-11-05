import { describe,it,expect } from "vitest";
import { claimMetrics,validateClaimInput,type CustomerClaim,type ClaimAction } from "./customer-claims";
import { claimFileMime,CLAIM_FILE_LIMIT } from "./customer-claim-files";
const walmart="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",liverpool="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const claim=(id:string,customer=walmart,status:CustomerClaim["status"]="open"):CustomerClaim=>({id,folio:id,external_organization_id:customer,received_at:"2026-11-05",title:"Reclamo real",description:"Descripción",status,external_reference:null,process_id:null,updated_at:"2026-11-05T00:00:00Z",cancelled_at:null,cancellation_reason:null});
const action=(id:string,claimId:string):ClaimAction=>({id,folio:id,title:"A3",external_organization_id:walmart,quality_case_id:claimId,status:"open"});
describe("customer claim counting",()=>{
 it("counts Walmart once before and after multiple A3 links; edits do not add a claim",()=>{
  const c=claim("1");expect(claimMetrics([c],[])).toEqual({received:1,open:1,closed:0,withoutA3:1});
  expect(claimMetrics([c,{...c,title:"Editado"}],[action("a","1"),action("b","1")])).toEqual({received:1,open:1,closed:0,withoutA3:0});
  expect(claimMetrics([c],[{...action("foreign","1"),external_organization_id:liverpool}]).withoutA3).toBe(1);
 });
 it("isolates Liverpool, uses receipt dates, includes closed in received, excludes annulments",()=>{
  const rows=[claim("1"),claim("2",walmart,"closed"),claim("3",liverpool),{...claim("4"),cancelled_at:"2026-11-06",cancellation_reason:"Duplicado"},{...claim("5"),received_at:"2025-01-01"}];
  expect(claimMetrics(rows,[],{customerId:walmart,from:"2026-01-01",to:"2026-12-31"})).toEqual({received:2,open:1,closed:1,withoutA3:2});
  expect(claimMetrics(rows,[],{customerId:liverpool}).received).toBe(1);
  expect(claimMetrics([],[]).received).toBe(0);
 });
 it("rejects names instead of UUIDs, invalid dates and unsupported states",()=>{
  const input={id:walmart,customerId:liverpool,receivedAt:"2026-11-05",title:"Reclamo",description:"Descripción",status:"open"};
  expect(()=>validateClaimInput(input)).not.toThrow();
  for(const patch of [{customerId:"Walmart"},{receivedAt:"2026-02-30"},{status:"cancelled"},{description:""}])expect(()=>validateClaimInput({...input,...patch})).toThrow();
 });
});
describe("private evidence content validation",()=>{
 it("accepts PDF, images and exported mail without extracting contents",()=>{
  expect(claimFileMime("evidence.pdf",new TextEncoder().encode("%PDF-1.7\n"))).toBe("application/pdf");
  expect(claimFileMime("evidence.png",new Uint8Array([137,80,78,71,13,10,26,10]))).toBe("image/png");
  expect(claimFileMime("mail.eml",new TextEncoder().encode("From: customer@example.test\r\nSubject: Claim\r\n\r\nText"))).toBe("message/rfc822");
 });
 it("rejects executables, renamed HTML, missing content and oversized payloads",()=>{
  for(const [name,data] of [["x.exe",new Uint8Array([77,90])],["x.pdf",new TextEncoder().encode("<html>unsafe</html>")],["x.png",new Uint8Array()],["x.pdf",new Uint8Array(CLAIM_FILE_LIMIT+1)]] as const)expect(()=>claimFileMime(name,data)).toThrow();
 });
});
