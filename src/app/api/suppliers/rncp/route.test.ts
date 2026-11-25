import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ flow:vi.fn(), context:vi.fn(),session: vi.fn(), rpc: vi.fn(), protocol:vi.fn(), current:vi.fn(), lookups: [] as string[], filters: [] as Array<{ table: string; field: string; ids: string[] }>, rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/rncp/initial-photo-server",()=>({requirePhotoV2:state.protocol,photoFailure:(error:Error & {status?:number})=>Response.json({error:error.message},{status:error.status??503}),photoRpcError:(error:{code:string;message:string})=>{throw Object.assign(new Error(error.message),{status:error.code==="PGRST202"?503:409});}}));
vi.mock("@/lib/rncp/flow-server",()=>({requireRncpFlow:state.flow}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: state.session }));
function client() { return { rpc:state.rpc,from(table: string) {
  const query = { select: () => query, order: () => query, eq: (_field: string, id: string) => { state.lookups.push(id); return query; }, maybeSingle: state.current,
    in: (field: string, ids: string[]) => { state.filters.push({ table, field, ids }); return query; },
    range: async () => ({ data: table === "supplier_rncp_reports" ? state.rows : [], count: table === "supplier_rncp_reports" ? state.rows.length : 0, error: null }) };
  return query;
} }; }
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client() }));
vi.mock("@/lib/rncp/server", () => ({ rncpContext:state.context, paginatedRows: async (page: (a: number, b: number) => Promise<{ data: unknown[] }>) => (await page(0, 499)).data, RncpError: class extends Error { constructor(message:string,public status=400){super(message);} } }));
import { GET,POST } from "./route";
beforeEach(() => {
  vi.stubEnv("RNCP_FLOW_ENABLED", "true");
  state.flow.mockReset();state.flow.mockResolvedValue(undefined);state.context.mockReset();state.context.mockResolvedValue({supplier:false,organizationId:"org-a",profile:{external_party_id:null}});
  state.lookups = []; state.current.mockReset(); state.current.mockResolvedValue({data:{purchase_order:"OC-260618"},error:null}); state.protocol.mockReset();state.protocol.mockResolvedValue(undefined);state.session.mockResolvedValue({ authUserId: "admin" }); state.filters = [];state.rpc.mockReset();state.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==="iq_rncp_requirements_summary"?{data:Object.fromEntries((args.p_report_ids as string[]).map(id=>[id,[]])),error:null}:{data:{id:"same-report",folio:"RNCP0227",status:"draft"},error:null});
  state.rows = [{ organization_id:"org-a",id: "authorized-report", folio: "TEST-1", supplier_id: "supplier-a", supplier: { code: "TEST-A", name: "Synthetic supplier" },
    source_kind: "historical", historical_status: "Cerrado", status: "closed", complete_submitted_at: null,
    validated_at: null, validation_outcome: null, closed_at: null }];
});
it("keeps previously saved RNCP editable while new classified registrations are disabled", async () => {
  vi.stubEnv("RNCP_FLOW_ENABLED", "false");
  const response = await POST(new Request("https://local.test/rncp", { method: "POST", body: JSON.stringify({ action: "draft", reportId: "existing", values: { description: "Existing flow" } }) }));
  expect(response.status).toBe(200);
  expect(state.flow).not.toHaveBeenCalled();
  expect(state.rpc).toHaveBeenCalledWith("save_supplier_rncp", expect.objectContaining({ requested_action: "draft" }));
});
it("blocks photo draft writes before their SQL is activated", async () => {
  vi.stubEnv("RNCP_FLOW_ENABLED", "false");
  const response = await POST(new Request("https://local.test/rncp", { method: "POST", body: JSON.stringify({ action: "draft", draftKey: "11111111-1111-4111-a111-111111111111", values: {} }) }));
  expect(response.status).toBe(503);
  expect(state.rpc).not.toHaveBeenCalled();
});
describe("RNCP effectiveness source fields", () => {
  it("preserves the original historical category without inventing response dates", async () => {
    const response = await GET(), data = await response.json();
    expect(response.status).toBe(200);
    expect(data.reports[0]).toMatchObject({ origin: "historical", historicalStatus: "Cerrado" });
    expect(data.reports[0].completeSubmittedAt).toBeUndefined();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("exposes stored native response and validation timestamps without deriving them from late", async () => {
    state.rows[0] = { ...state.rows[0], source_kind: "native", historical_status: null,
      notified_at: "2026-10-01T18:00:00Z", response_deadline: "2026-10-08T18:00:00Z",
      complete_submitted_at: "2026-10-09T18:00:00Z", validated_at: "2026-10-10T18:00:00Z", validation_outcome: "accepted" };
    const data = await (await GET()).json();
    expect(data.reports[0]).toMatchObject({ completeSubmittedAt: "2026-10-09T18:00:00Z",
      validatedAt: "2026-10-10T18:00:00Z", validationOutcome: "accepted" });
    expect(state.filters.filter(f => f.table === "audit_log" || f.table === "supplier_rncp_actions")
      .every(f => f.ids.length === 1 && f.ids[0] === "authorized-report")).toBe(true);
  });
  it("denies missing sessions before reading source fields", async () => {
    state.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(state.filters).toEqual([]);
  });
});

describe("photo draft retry key",()=>{
 const request=()=>new Request("https://local.test/api/suppliers/rncp",{method:"POST",body:JSON.stringify({action:"draft",draftKey:"11111111-1111-4111-a111-111111111111",values:{classification:"QAC",description:"Synthetic"}})});
 it("forwards the same creation key to the guarded draft RPC on retry",async()=>{const a=await(await POST(request())).json(),b=await(await POST(request())).json();expect(a.report.id).toBe(b.report.id);expect(a.requiresReload).toBe(true);expect(b.requiresReload).toBe(true);expect(state.rpc).toHaveBeenCalledTimes(2);expect(state.rpc.mock.calls.every(c=>c[0]==="iq_rncp_initial_photo_draft"&&c[1].p_request==="11111111-1111-4111-a111-111111111111")).toBe(true);});
 it("does not fall back to a second unkeyed creation if activation is absent",async()=>{state.rpc.mockResolvedValue({data:null,error:{code:"PGRST202",message:"missing"}});expect((await POST(request())).status).toBe(503);expect(state.rpc).toHaveBeenCalledTimes(1);expect(state.rpc.mock.calls[0][0]).toBe("iq_rncp_initial_photo_draft");});
});

describe("V2 draft compatibility",()=>{
 it("does not confirm a save when the RPC returns an empty identity",async()=>{
   state.rpc.mockResolvedValue({data:null,error:null});
   const response=await POST(new Request("https://local.test/rncp",{method:"POST",body:JSON.stringify({action:"draft",draftKey:"11111111-1111-4111-a111-111111111111",values:{classification:"QAC"}})}));
   expect(response.status).toBe(502);
   expect(await response.json()).not.toHaveProperty("report");
 });
 it("does not invoke draft or legacy writes when readiness fails",async()=>{
  state.protocol.mockRejectedValue(Object.assign(new Error("V2 missing"),{status:503}));
  const result=await POST(new Request("https://local.test/rncp",{method:"POST",body:JSON.stringify({action:"draft",draftKey:"11111111-1111-4111-a111-111111111111",values:{classification:"QAC",description:"Old"}})}));
  expect(result.status).toBe(503);expect(state.rpc).not.toHaveBeenCalled();
 });
 it("returns the current draft identity requiring a reopen instead of a follow-up legacy save",async()=>{
  state.rpc.mockResolvedValue({data:{id:"existing",folio:"TEST-1",status:"submitted"},error:null});
  const result=await POST(new Request("https://local.test/rncp",{method:"POST",body:JSON.stringify({action:"draft",draftKey:"11111111-1111-4111-a111-111111111111",values:{classification:"QAC",description:"Old"}})}));
  expect(await result.json()).toMatchObject({report:{id:"existing",status:"submitted"},requiresReload:true});expect(state.rpc).toHaveBeenCalledTimes(1);
 });
});



describe("RNCP flow contract and historical compatibility",()=>{
 const request=(values:Record<string,unknown>,reportId?:string)=>new Request("https://local.test/rncp",{method:"POST",body:JSON.stringify({action:"draft",reportId,draftKey:"11111111-1111-4111-a111-111111111111",values})});
 it("saves a draft before classification and requires classification to register a new report",async()=>{
  expect((await POST(request({}))).status).toBe(200);
  const submit=new Request("https://local.test/rncp",{method:"POST",body:JSON.stringify({action:"submit",values:{}})});
  expect((await POST(submit)).status).toBe(400);
 });
 it.each(["Colorantes","qac",""])("rejects an unclassified new report: %s",async classification=>{
  expect((await POST(request({classification}))).status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
 });
 it("requires a stable creation key before assigning a new folio",async()=>{
  const response=await POST(new Request("https://local.test/rncp",{method:"POST",body:JSON.stringify({action:"draft",values:{classification:"Hilo"}})}));
  expect(response.status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();
 });
 it("blocks unkeyed new reports when V2 is off", async()=>{
  vi.stubEnv("RNCP_FLOW_ENABLED","false");
  expect((await POST(request({}))).status).toBe(503);
  expect(state.rpc).not.toHaveBeenCalled();
 });
 it("does not write against a legacy RPC contract",async()=>{state.flow.mockRejectedValue(Object.assign(new Error("missing contract"),{status:503}));expect((await POST(request({classification:"QAC"}))).status).toBe(503);expect(state.rpc).not.toHaveBeenCalled();});
 it("keeps purchase_order out of the client payload; SQL preserves it under lock",async()=>{
  expect((await POST(request({classification:"Hilo",purchaseOrder:"attempted",purchase_order:"attempted"},"authorized-report"))).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith("save_supplier_rncp",expect.objectContaining({requested_payload:{classification:"Hilo"}}));expect(state.current).not.toHaveBeenCalled();
 });
 it("does not expose stored purchase orders",async()=>{state.rows[0].purchase_order="OC-260618";const data=await(await GET()).json();expect(data.reports[0]).not.toHaveProperty("purchaseOrder");expect(data.reports[0]).not.toHaveProperty("purchase_order");});
 it("denies a different supplier before privileged audit reads",async()=>{state.context.mockResolvedValue({supplier:true,profile:{external_party_id:"other"}});expect((await GET()).status).toBe(403);expect(state.filters).toEqual([]);});
 it("denies an internal cross-organization result",async()=>{state.rows[0].organization_id="other";expect((await GET()).status).toBe(403);});
 it("uses a live authorization failure",async()=>{state.context.mockRejectedValue(new Error("revoked"));expect((await GET()).status).toBe(503);expect(state.filters).toEqual([]);});
 it("preserves numeric descending order",async()=>{const base=state.rows[0];state.rows=[{...base,id:"a",folio:"RNCP9"},{...base,id:"b",folio:"RNCP0010"}];const data=await(await GET()).json();expect(data.reports.map((r:{folio:string})=>r.folio)).toEqual(["RNCP0010","RNCP9"]);});
});
