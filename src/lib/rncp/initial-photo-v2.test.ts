import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({context:vi.fn(),user:vi.fn(),admin:vi.fn(),upload:vi.fn(),download:vi.fn()}));
vi.mock("./server",()=>({rncpContext:state.context,RncpError:class extends Error{constructor(m:string,public status=400){super(m);}}}));
import { RncpError } from "./server";
import { GET,POST,PUT } from "@/app/api/suppliers/rncp/photos/route";
const report="11111111-1111-4111-a111-111111111111";
type Candidate={id:string;path:string;sha256:string;mime:string;size:number;width:number;height:number;name:string};
const reservations=new Map<string,{file:Candidate;verified:boolean}>(),objects=new Map<string,Blob>(),registry=new Set<string>();
let trace:string[],fail:string,revision:number,commits:number,bytes:Buffer,reportRow:Record<string,unknown>;
const error=(message:string,code="P0001")=>({data:null,error:{message,code}});
const request=()=>{const form=new FormData();form.set("reportId",report);form.set("file",new File([new Uint8Array(bytes).buffer],"defecto.png",{type:"image/png"}));return new Request("https://local.test/photos",{method:"POST",body:form});};
const commit=()=>PUT(new Request("https://local.test/photos",{method:"PUT",body:JSON.stringify({reportId:report,fileIds:[],revision:0,reason:"Prueba concurrente"})}));
// In-memory contract model, NOT SQL/RLS validation. Real Sharp decode and route orchestration.
beforeEach(async()=>{
 vi.stubEnv("RNCP_FLOW_ENABLED","true");
 vi.clearAllMocks();reservations.clear();objects.clear();registry.clear();trace=[];fail="";revision=0;commits=0;
 bytes=await sharp({create:{width:32,height:24,channels:3,background:"#ff0011"}}).png().toBuffer();
 reportRow={id:report,organization_id:"org-a",source_kind:"native",status:"draft",deleted_at:null,notified_at:null};
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:reportRow,error:null})};
 state.user.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==="iq_rncp_initial_photo_reserve"){
   if(args.p_report===null)return fail==="v1"?error("missing","PGRST202"):error("PHOTO_FORBIDDEN","42501");
   trace.push("reserve");const file=args.p_file as Candidate;
   if(fail.startsWith("quota"))return error(fail==="quota-report"?"PHOTO_REPORT_PREPARED_QUOTA":"PHOTO_ORG_PREPARED_QUOTA");
   if(!reservations.has(file.id))reservations.set(file.id,{file,verified:false});
   if(fail==="reserve-lost"){fail="";throw new Error("network after reservation");}
   if(fail==="reserve-tampered")return {data:{id:file.id,path:"foreign/path",verified:false},error:null};
   return {data:{id:file.id,path:file.path,verified:reservations.get(file.id)!.verified},error:null};
  }
  if(name==="iq_rncp_initial_photo_stage"){
   trace.push("stage");const file=args.p_file as Candidate,reserved=reservations.get(file.id);
   if(!reserved?.verified||JSON.stringify(reserved.file)!==JSON.stringify(file))return error("PHOTO_BACKEND_VERIFICATION_REQUIRED","42501");
   registry.add(file.id);
   if(fail==="stage-lost"){fail="";throw new Error("network after stage");}
   return {data:file.id,error:null};
  }
  if(name==="iq_rncp_initial_photo_commit"){
   trace.push("commit");if(args.p_revision!==revision)return error("PHOTO_CONFLICT");
   revision++;commits++;return {data:{revision,files:[]},error:null};
  }
  return {data:{revision,files:[]},error:null};
 });
 state.admin.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  expect(name).toBe("iq_rncp_initial_photo_attest");
  if(args.p_file_id===null)return fail==="no-attest"?error("missing","PGRST202"):error("PHOTO_VERIFICATION_MISMATCH");
  trace.push("attest");const reserved=reservations.get(String(args.p_file_id));
  expect(reserved?.file).toEqual(args.p_verified);reserved!.verified=true;
  if(fail==="attest-lost"){fail="";throw new Error("network after attestation");}
  return {data:null,error:null};
 });
 state.upload.mockImplementation(async(path:string,data:Uint8Array,options:{contentType:string;upsert:boolean})=>{
  trace.push("upload");expect(options.upsert).toBe(false);
  expect([...reservations.values()].some(r=>r.file.path===path)).toBe(true);
  if(objects.has(path))return error("exists");
  objects.set(path,new Blob([new Uint8Array(data).buffer],{type:options.contentType}));
  if(fail==="upload-lost"){fail="";throw new Error("network after upload");}
  return {data:null,error:null};
 });
 state.download.mockImplementation(async(path:string)=>{
  trace.push("download");
  if(fail==="download-lost"){fail="";return error("temporarily unavailable");}
  if(fail==="changed-bytes"){
   const changed=await sharp({create:{width:32,height:24,channels:3,background:"#0011ff"}}).png().toBuffer();
   return {data:new Blob([new Uint8Array(changed).buffer],{type:"image/png"}),error:null};
  }
  if(fail==="changed-mime")return {data:new Blob([new Uint8Array(bytes).buffer],{type:"image/jpeg"}),error:null};
  if(fail==="changed-size")return {data:new Blob(["invalid"],{type:"image/png"}),error:null};
  return {data:objects.get(path),error:null};
 });
 state.context.mockResolvedValue({organizationId:"org-a",supabase:{from:()=>query,rpc:state.user},admin:{rpc:state.admin,storage:{from:(bucket:string)=>{expect(bucket).toBe("integraq-private");return {upload:state.upload,download:state.download};}}}});
});
describe("V2 private upload orchestration",()=>{
 it("reserves before upload, downloads even successful uploads and attests backend-derived bytes before staging",async()=>{
  expect((await POST(request())).status).toBe(200);expect(trace).toEqual(["reserve","upload","download","attest","stage"]);
  expect(registry.size).toBe(1);expect(state.user.mock.calls.some(([name])=>String(name).includes("action_evidence")||String(name).includes("notif"))).toBe(false);
 });
 it.each(["v1","no-attest"])("fails closed before any upload against incompatible %s RPCs",async mode=>{
  fail=mode;expect((await POST(request())).status).toBe(503);expect(reservations.size).toBe(0);expect(state.upload).not.toHaveBeenCalled();
 });
 it("does not announce capability on V1",async()=>{fail="v1";expect((await GET(new Request("https://local.test/photos"))).status).toBe(503);});
 it("rejects a manipulated reservation before writing Storage",async()=>{fail="reserve-tampered";expect((await POST(request())).status).toBe(409);expect(objects.size).toBe(0);expect(registry.size).toBe(0);});
 it.each(["quota-report","quota-org"])("reports %s without uploading or deleting anything",async mode=>{
  fail=mode;const response=await POST(request());expect(response.status).toBe(409);expect((await response.json()).error).toContain("cuota");expect(trace).toEqual(["reserve"]);expect(objects.size).toBe(0);
 });
 it.each(["reserve-lost","upload-lost","download-lost","attest-lost","stage-lost"])("recovers %s with the same reservation, private object and file identity",async mode=>{
  fail=mode;const first=await POST(request());expect([200,503]).toContain(first.status);
  const retry=await POST(request());expect(retry.status).toBe(200);expect(reservations.size).toBe(1);expect(objects.size).toBe(1);expect(registry.size).toBe(1);
  if(mode==="attest-lost"||mode==="stage-lost")expect(state.upload).toHaveBeenCalledTimes(1);
 });
 it.each(["changed-bytes","changed-size","changed-mime"])("never attests or registers %s read from private Storage",async mode=>{
  fail=mode;expect((await POST(request())).status).toBe(409);expect(trace).not.toContain("attest");expect(trace).not.toContain("stage");expect(registry.size).toBe(0);
 });
 it("simultaneous uploads resolve to one reservation, object and file, without overwriting",async()=>{
  const result=await Promise.all([POST(request()),POST(request())]);expect(result.map(r=>r.status)).toEqual([200,200]);
  expect(reservations.size).toBe(1);expect(objects.size).toBe(1);expect(registry.size).toBe(1);
  expect((await result[0].json()).id).toBe((await result[1].json()).id);
 });
 it("one of two simultaneous confirmations with the same revision conflicts",async()=>{
  const results=await Promise.all([commit(),commit()]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(commits).toBe(1);expect(revision).toBe(1);
 });
 it("does not accept browser-supplied verification or identity",async()=>{
  const form=new FormData();form.set("reportId",report);form.set("file",new File([new Uint8Array(bytes).buffer],"defecto.png",{type:"image/png"}));form.set("p_verified",JSON.stringify({sha256:"fake",verified:true}));
  expect((await POST(new Request("https://local.test/photos",{method:"POST",body:form}))).status).toBe(400);expect(trace).toEqual([]);
 });
 it("rejects a notified draft and another organization's report before touching Storage",async()=>{
  reportRow.notified_at="2026-11-09";expect((await POST(request())).status).toBe(409);
  reportRow.notified_at=null;reportRow.organization_id="org-b";expect((await POST(request())).status).toBe(403);expect(trace).toEqual([]);
 });
 it("does not disclose unexpected transport errors or secrets to the browser",async()=>{
  state.context.mockRejectedValue(new Error("secret database url"));const response=await POST(request());expect(response.status).toBe(503);expect((await response.json()).error).not.toContain("secret");
 });
 it("bounds a streamed body without Content-Length before parsing multipart or reserving",async()=>{
  const response=await POST(new Request("https://local.test/photos",{method:"POST",headers:{"Content-Type":"multipart/form-data; boundary=test"},body:new Uint8Array(4*1024*1024+65537)}));
  expect(response.status).toBe(413);expect(trace).toEqual([]);
 });
 it("denies an unauthenticated upload before consuming its body",async()=>{
  state.context.mockRejectedValue(new RncpError("Sesión no válida",401));
  const req=request(),read=vi.spyOn(req,"formData");expect((await POST(req)).status).toBe(401);expect(req.bodyUsed).toBe(false);expect(read).not.toHaveBeenCalled();
 });

});
