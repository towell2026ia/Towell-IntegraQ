import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({createClient:vi.fn(),createAdminClient:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:mocks.createClient}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mocks.createAdminClient}));
import { PATCH } from "./route";
const account={authUserId:"11111111-1111-4111-8111-111111111111",accessRevision:"2026-10-28T00:00:00Z",fullName:"Existing",email:"existing@example.invalid",documentAccess:[],moduleActionPermissions:[],assignedModuleIds:[],specificPermissions:{"portal_clientes.acceder":false},permissionChanges:{"portal_clientes.acceder":false}};
let rpc:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  const chain:Record<string,ReturnType<typeof vi.fn>>={};
  for(const m of ["select","eq"])chain[m]=vi.fn(()=>chain);
  chain.maybeSingle=vi.fn().mockResolvedValue({data:{user_type:"administrator",status:"active",workspace_mode:"production"}});
  rpc=vi.fn().mockResolvedValue({data:{ok:true},error:null});
  mocks.createClient.mockResolvedValue({auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:"admin"}}})},from:vi.fn(()=>chain),rpc});
  mocks.createAdminClient.mockReset();
});
const send=(body:unknown=account)=>PATCH(new Request("https://preview.example/api/admin/users",{method:"PATCH",body:JSON.stringify(body)}));
describe("existing user access mutation",()=>{
  it("saves an existing user's grants and revocations in one authenticated RPC without deleting any users/files",async()=>{
    expect((await send()).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_user_access",{requested_user_id:account.authUserId,expected_revision:account.accessRevision,requested_account:account});
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it("rejects a stale editor without claiming success",async()=>{
    rpc.mockResolvedValue({error:{code:"40001",message:"ACCESS_STALE"}});
    expect((await send()).status).toBe(409);
  });
  it("keeps migration acceptance pending without a nontransactional fallback",async()=>{
    rpc.mockResolvedValue({error:{code:"PGRST202",message:"function missing"}});
    expect((await send()).status).toBe(503);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it("reports preservation without fallback writes for a protected assignment",async()=>{
    rpc.mockResolvedValue({error:{message:"ACCESS_EXISTING_ASSIGNMENT_PRESERVED"}});
    expect((await send()).status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it("requires a current saved revision",async()=>{
    expect((await send({...account,accessRevision:undefined})).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not let an unauthenticated request change permissions",async()=>{
    mocks.createClient.mockResolvedValue({auth:{getUser:vi.fn().mockResolvedValue({data:{user:null}})}});
    expect((await send()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
