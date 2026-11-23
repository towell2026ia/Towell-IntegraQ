import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";
const state = vi.hoisted(() => ({ session: null as ActiveSession | null, profile: {} as Record<string,unknown>, pages: [] as Array<{data: unknown; error: unknown}>, calls: [] as Array<{table: string; method: string; args: unknown[]}>, rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
function tableQuery(table: string) {
  const chain: Record<string,unknown> = {};
  for (const method of ["select","eq","is","not","neq","order","range"]) chain[method] = (...args: unknown[]) => { state.calls.push({table,method,args}); return chain; };
  chain.maybeSingle = async () => ({data: state.profile,error:null});
  chain.then = (resolve: (value: unknown) => unknown) => resolve(state.pages.shift() ?? {data:[],error:null});
  return chain;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({rpc: state.rpc, from: tableQuery}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({rpc: state.rpc, from: tableQuery}) }));
import { GET, POST } from "./route";
import { GET as operationalGET } from "../internal-actions/route";
const id="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const timestamp="2026-11-06T22:15:22.472Z";
const request=(body: unknown)=>new Request("https://integraq.test/api/root2cause/retired-actions",{method:"POST",body:JSON.stringify(body)});
const valid={id,reason:"Recuperación verificada",expectedDeletedAt:timestamp,confirmed:true};
beforeEach(()=>{
  vi.stubEnv("IQ_SGC_RECOVERY_ENABLED", "false");
  state.session={...activeSession,userType:"Administrador",authUserId:id,organizationId:"org-a",workspaceMode:"production"};
  state.profile={organization_id:"org-a",user_type:"administrator",status:"active",workspace_mode:"production"};
  state.pages=[];state.calls=[];state.rpc.mockReset();
});
describe("administrative Root2Cause retirements",()=>{
  it.each([null,"Usuario interno","Cliente","Proveedor"])("denies %s before reading retirements",async role=>{
    state.session=role ? {...state.session!,userType:role as ActiveSession["userType"]}:null;
    expect((await GET()).status).toBe(403);expect(state.calls).toHaveLength(0);
  });
  it.each([{status:"inactive"},{organization_id:"org-b"},{workspace_mode:"demo"},{user_type:"internal"}])("rechecks the persisted administrator %j",async changes=>{
    Object.assign(state.profile,changes);expect((await GET()).status).toBe(403);expect(state.calls.filter(c=>c.table==="corrective_actions")).toHaveLength(0);
  });
  it("scopes to the organization and excludes active, cross-organization and supplier records",async()=>{
    state.pages=[{data:[{id,organization_id:"org-a",source:"internal",deleted_at:timestamp},{id:"other",organization_id:"org-b",source:"internal",deleted_at:timestamp},{id:"active",organization_id:"org-a",source:"internal",deleted_at:null},{id:"supplier",organization_id:"org-a",source:"supplier",deleted_at:timestamp}],error:null}];
    const response=await GET();const body=await response.json();expect(body.actions.map((r:{id:string})=>r.id)).toEqual([id]);expect(body.recoveryEnabled).toBe(false);
    expect(state.calls).toContainEqual({table:"corrective_actions",method:"eq",args:["organization_id","org-a"]});expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("paginates beyond the first 500 retirements",async()=>{
    state.pages=[{data:Array.from({length:500},(_,i)=>({id:String(i),organization_id:"org-a",source:"internal",deleted_at:timestamp})),error:null},{data:[{id,organization_id:"org-a",source:"internal",deleted_at:timestamp}],error:null}];
    expect((await (await GET()).json()).actions).toHaveLength(501);
    expect(state.calls).toContainEqual({table:"corrective_actions",method:"range",args:[500,999]});
  });
  it("reports read errors without claiming an empty registry",async()=>{state.pages=[{data:null,error:{message:"database"}}];expect((await GET()).status).toBe(500);});
  it.each([{...valid,confirmed:false},{...valid,reason:" "},{...valid,id:"invalid"},{...valid,expectedDeletedAt:"invalid"},null])("rejects invalid recovery %j",async body=>{expect((await POST(request(body))).status).toBe(400);expect(state.rpc).not.toHaveBeenCalled();});
  it("cannot restore before explicit activation",async()=>{expect((await POST(request(valid))).status).toBe(503);expect(state.rpc).not.toHaveBeenCalled();});
  it("binds the backend RPC to the authenticated administrator and exact retirement token",async()=>{
    vi.stubEnv("IQ_SGC_RECOVERY_ENABLED","true");state.rpc.mockResolvedValue({data:{id,auditId:"receipt"},error:null});
    expect((await POST(request(valid))).status).toBe(200);expect(state.rpc).toHaveBeenCalledWith("iq_sgc_restore_corrective_action",{requested_actor:id,requested_id:id,expected_deleted_at:timestamp,requested_reason:valid.reason,requested_confirmation:true});
  });
  it("does not claim success on a transaction conflict",async()=>{vi.stubEnv("IQ_SGC_RECOVERY_ENABLED","true");state.rpc.mockResolvedValue({data:null,error:{code:"PT409"}});expect((await POST(request(valid))).status).toBe(409);});
});

describe("Root2Cause operational regression",()=>{
  it("reload retains every authorized active and closed record and excludes retired/other organizations",async()=>{
    const rows=[{id:"open",organization_id:"org-a",status:"open",deleted_at:null},{id:"closed",organization_id:"org-a",status:"closed",deleted_at:null},{id:"retired",organization_id:"org-a",status:"closed",deleted_at:timestamp},{id:"other",organization_id:"org-b",deleted_at:null}];
    const visibleRows=rows.map(row=>({...row,iq_u08_case_visible:true}));
    state.pages=[{data:visibleRows,error:null},{data:visibleRows,error:null}];
    const first=await (await operationalGET()).json();const reloaded=await (await operationalGET()).json();
    expect(first.actions.map((r:{id:string})=>r.id)).toEqual(["open","closed"]);expect(reloaded).toEqual(first);
    expect(state.calls).toContainEqual({table:"corrective_actions",method:"is",args:["deleted_at",null]});
  });
  it("rejects recovery from external and internal users even if enabled",async()=>{
    vi.stubEnv("IQ_SGC_RECOVERY_ENABLED","true");
    for(const userType of ["Usuario interno","Cliente","Proveedor"] as const){state.session={...state.session!,userType};expect((await POST(request(valid))).status).toBe(403);}
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
