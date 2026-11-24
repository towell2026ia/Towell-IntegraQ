import {beforeEach,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),allowed:vi.fn()}));
vi.mock("@/lib/supabase/auth-session",()=>({getAuthenticatedSession:mock.session}));
vi.mock("@/lib/module-permissions",()=>({canPerformModuleAction:mock.allowed}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mock.rpc})}));
vi.mock("@/lib/root2cause/redbooth-ledger",()=>({readConfirmedTaskLinks:vi.fn()}));
import {GET,POST} from "./route";
const req=(body:unknown)=>new Request("https://example.test/api/root2cause/plan-followup",{method:"POST",body:JSON.stringify(body)});
const cmd={id:"plan",command:"complete",revision:2,note:"avance",fileId:"file"};
beforeEach(()=>{vi.resetAllMocks();mock.session.mockResolvedValue({authUserId:"operator",workspaceMode:"production",userType:"Usuario interno"});mock.allowed.mockReturnValue(true);});
it("reads only records of the session RPC",async()=>{mock.rpc.mockResolvedValue({data:[],error:null});expect((await GET(new Request("https://example.test/"))).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith("iq_u08_plan_queue");});
it("refuses an external session before any query or write",async()=>{mock.session.mockResolvedValue({authUserId:"external",userType:"Cliente"});expect((await POST(req(cmd))).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();});
it("keeps optimistic revision and final evidence together",async()=>{mock.rpc.mockResolvedValue({error:{code:"40001"}});expect((await POST(req(cmd))).status).toBe(409);expect(mock.rpc).toHaveBeenCalledWith("iq_u08_update_plan",{p_owner:null,p_plan:"plan",p_command:"complete",p_file:"file",p_note:"avance",p_revision:2});});
it("reports an unavailable tracking contract separately from an empty queue",async()=>{mock.rpc.mockResolvedValue({error:{code:"PGRST202"}});expect((await GET(new Request("https://example.test/"))).status).toBe(503);});

it("comprueba el alcance vigente del plan antes de consultar su bitácora",async()=>{mock.rpc.mockResolvedValue({data:[],error:null});expect((await GET(new Request("https://example.test/?history=00000000-0000-4000-8000-000000000001"))).status).toBe(403);});
