import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({createClient:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>mock);
import { getAuthenticatedSession } from "./auth-session";
let profile:Record<string,unknown>|null, overrides:Array<Record<string,unknown>>;
let fail:boolean;
beforeEach(()=>{
  profile={external_id:"u",full_name:"Existing",user_type:"internal",status:"active",workspace_mode:"production"};
  overrides=[{allowed:true,permission:{code:"clientes.acceder"}}];fail=false;
  mock.createClient.mockResolvedValue({auth:{getClaims:async()=>({data:{claims:{sub:"auth-u",app_metadata:{user_type:"administrator",workspace_mode:"demo"}}}})},from:(table:string)=>{
    const result=()=>({data:table==="profiles"?profile:table==="user_permission_overrides"?overrides:table==="user_module_permissions"?[{module_id:"customers",can_view:true}]:[],error:fail&&table==="user_permission_overrides"?{message:"denied"}:null});
    const chain:Record<string,ReturnType<typeof vi.fn>>={};
    for(const name of ["select","eq"])chain[name]=vi.fn(()=>chain);
    chain.maybeSingle=vi.fn(async()=>result());chain.then=vi.fn((resolve:(value:unknown)=>unknown)=>Promise.resolve(result()).then(resolve));
    return chain;
  },rpc:vi.fn().mockResolvedValue({data:true,error:null})});
});
describe("fresh persisted session permissions",()=>{
  it("uses the active database profile instead of stale app metadata",async()=>{
    expect(await getAuthenticatedSession()).toMatchObject({userType:"Usuario interno",workspaceMode:"production",specificPermissions:{"clientes.acceder":true}});
  });
  it("reloads a saved revocation on the next session reconstruction",async()=>{
    expect((await getAuthenticatedSession())?.specificPermissions?.["clientes.acceder"]).toBe(true);
    overrides=[{allowed:false,permission:{code:"clientes.acceder"}}];
    expect((await getAuthenticatedSession())?.specificPermissions?.["clientes.acceder"]).toBe(false);
  });
  it("preserves the current company portal grant inherited through a database role",async()=>{
    profile={...profile,user_type:"customer",external_party_kind:"customer",external_party_id:"company-a",external_party_name:"A"};
    overrides=[];
    expect((await getAuthenticatedSession())?.specificPermissions?.["portal_clientes.acceder"]).toBe(true);
  });
  it("does not resurrect an administrator from JWT metadata when the profile is missing",async()=>{profile=null;expect(await getAuthenticatedSession()).toBeNull();});
  it("fails closed when current permissions cannot be loaded",async()=>{fail=true;expect(await getAuthenticatedSession()).toBeNull();});
});
