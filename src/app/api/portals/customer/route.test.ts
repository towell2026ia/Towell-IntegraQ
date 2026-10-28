import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({session:{userId:"a",authUserId:"a",name:"A",shortName:"A",initials:"A",position:"P",department:"D",company:"A",userType:"Cliente",assignedProcessIds:[],workspaceMode:"production",specificPermissions:{"portal_clientes.acceder":true},externalParty:{kind:"customer",companyId:"company-a",companyName:"A"}},createClient:vi.fn()}));
vi.mock("@/lib/supabase/auth-session",()=>({getAuthenticatedSession:async()=>m.session}));
vi.mock("@/lib/supabase/server",()=>({createClient:m.createClient}));
import { GET } from "./route";
let scopes:Record<string,Array<unknown[]>>;
beforeEach(()=>{
  scopes={};m.session.specificPermissions["portal_clientes.acceder"]=true;m.session.workspaceMode="production";
  m.createClient.mockReset().mockResolvedValue({from:(table:string)=>{
    const chain:Record<string,ReturnType<typeof vi.fn>>={};
    chain.select=vi.fn(()=>chain);chain.is=vi.fn(()=>chain);chain.in=vi.fn(()=>chain);
    chain.eq=vi.fn((...args)=>{(scopes[table]??=[]).push(args);return chain;});
    chain.then=vi.fn((resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==="corrective_actions"?[
      {id:"a",external_organization_id:"company-a",title:"Own",source:"customer"},{id:"b",external_organization_id:"company-b",title:"Other",source:"customer"}]:[]}).then(resolve));
    return chain;
  }});
});
describe("customer portal server scope",()=>{
  it("binds the query to authenticated customer A and excludes B",async()=>{
    const response=await GET(),payload=await response.json();
    expect(response.status).toBe(200);expect(payload.actions.map((a:{id:string})=>a.id)).toEqual(["a"]);
    expect(scopes.corrective_actions).toContainEqual(["external_organization_id","company-a"]);
    expect(scopes.corrective_actions).toContainEqual(["portal_visible",true]);
    expect(scopes.audits).toContainEqual(["external_organization_id","company-a"]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("does not query business data without an explicit portal permission",async()=>{
    m.session.specificPermissions["portal_clientes.acceder"]=false;
    expect((await GET()).status).toBe(403);expect(m.createClient).not.toHaveBeenCalled();
  });
  it("does not load productive records for a demo session",async()=>{
    m.session.workspaceMode="demo";
    expect((await GET()).status).toBe(403);expect(m.createClient).not.toHaveBeenCalled();
  });
});
