import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({session:{userId:"a",authUserId:"a",name:"A",shortName:"A",initials:"A",position:"P",department:"D",company:"A",userType:"Proveedor",assignedProcessIds:[],workspaceMode:"production",specificPermissions:{"portal_proveedores.acceder":true},externalParty:{kind:"supplier",companyId:"company-a",companyName:"A",siteId:"site-a"}},createClient:vi.fn(),sign:vi.fn()}));
vi.mock("@/lib/supabase/auth-session",()=>({getAuthenticatedSession:async()=>mocks.session}));
vi.mock("@/lib/supabase/server",()=>({createClient:mocks.createClient}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({storage:{from:()=>({createSignedUrl:mocks.sign})}})}));
import { GET } from "./route";
let row:Record<string,unknown>;
beforeEach(()=>{
  row={source_file_id:"file",supplier_id:"company-a",site_id:"site-a",portal_visible:true};
  mocks.session.specificPermissions["portal_proveedores.acceder"]=true;
  mocks.sign.mockReset().mockResolvedValue({data:{signedUrl:"private"},error:null});
  mocks.createClient.mockResolvedValue({from:(table:string)=>{
    const chain:Record<string,ReturnType<typeof vi.fn>>={};
    for(const m of ["select","eq","is"])chain[m]=vi.fn(()=>chain);
    chain.maybeSingle=vi.fn(async()=>({data:table==="supplier_assessments"?row:{bucket_id:"private",object_path:"source.xlsx",original_name:"source.xlsx"}}));
    return chain;
  }});
});
const read=()=>GET(new Request("https://preview.example/file"),{params:Promise.resolve({assessmentId:"assessment"})});
describe("supplier assessment file authorization",()=>{
  it("opens its own company and site source",async()=>{expect((await read()).status).toBe(200);expect(mocks.sign).toHaveBeenCalledTimes(1);});
  it("never signs company B's source for supplier A",async()=>{row.supplier_id="company-b";expect((await read()).status).toBe(404);expect(mocks.sign).not.toHaveBeenCalled();});
  it("denies another site",async()=>{row.site_id="site-b";expect((await read()).status).toBe(404);expect(mocks.sign).not.toHaveBeenCalled();});
  it("denies unpublished files",async()=>{row.portal_visible=false;expect((await read()).status).toBe(404);});
  it("revocation blocks the next request even with an existing authenticated session",async()=>{
    expect((await read()).status).toBe(200);
    mocks.session.specificPermissions["portal_proveedores.acceder"]=false;
    expect((await read()).status).toBe(403);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
});
