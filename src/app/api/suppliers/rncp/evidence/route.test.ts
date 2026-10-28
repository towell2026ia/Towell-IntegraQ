import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({createClient:vi.fn(),createAdminClient:vi.fn()}));
vi.mock("@/lib/supabase/auth-session",()=>({getAuthenticatedSession:async()=>({userId:"u",authUserId:"u",userType:"Proveedor",workspaceMode:"production",assignedProcessIds:[],specificPermissions:{"portal_proveedores.acceder":true},externalParty:{kind:"supplier",companyId:"company-a",companyName:"A"}})}));
vi.mock("@/lib/supabase/server",()=>({createClient:m.createClient}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:m.createAdminClient}));
import { POST } from "./route";
let failMetadata:boolean, foreignCompany:boolean, remove:ReturnType<typeof vi.fn>, erase:ReturnType<typeof vi.fn>, upload:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  failMetadata=true;foreignCompany=false;remove=vi.fn();erase=vi.fn();upload=vi.fn().mockResolvedValue({error:null});
  m.createClient.mockResolvedValue({from:(table:string)=>{
    const data=table==="supplier_rncp_actions"?{id:"action",report_id:"report",created_by:"u"}:table==="file_upload_policies"?{max_size_bytes:10000,allowed_mime_types:["application/pdf"]}:{id:"report",folio:"RNCP-1",supplier_id:foreignCompany?"company-b":"company-a",site_id:null,status:"submitted",deleted_at:null,portal_visible:true};
    const q:Record<string,ReturnType<typeof vi.fn>>={};for(const method of ["select","eq"])q[method]=vi.fn(()=>q);q.maybeSingle=vi.fn().mockResolvedValue({data,error:null});return q;
  }});
  m.createAdminClient.mockReturnValue({storage:{from:()=>({upload,remove})},from:(table:string)=>{
    const q:Record<string,ReturnType<typeof vi.fn>>={};q.insert=vi.fn(()=>q);q.select=vi.fn(()=>q);q.delete=erase;
    q.single=vi.fn(async()=>({data:failMetadata?null:{id:"new-file",original_name:"proof.pdf",mime_type:"application/pdf",size_bytes:3,uploaded_by:"u",created_at:"2026-10-28"},error:failMetadata?{message:"uncertain"}:null}));
    q.then=vi.fn((resolve:(v:unknown)=>unknown)=>Promise.resolve({error:table==="supplier_rncp_action_evidence"?{message:"link failure"}:null}).then(resolve));return q;
  }});
});
async function send(){const body=new FormData();body.set("actionId","action");body.set("file",new File(["pdf"],"proof.pdf",{type:"application/pdf"}));return POST(new Request("https://preview.example/evidence",{method:"POST",body}));}
describe("evidence preservation on uncertain responses",()=>{
  it("keeps the binary when registration cannot be confirmed",async()=>{expect((await send()).status).toBe(500);expect(upload).toHaveBeenCalledOnce();expect(remove).not.toHaveBeenCalled();expect(erase).not.toHaveBeenCalled();});
  it("keeps both metadata and binary when the link response fails",async()=>{failMetadata=false;expect((await send()).status).toBe(500);expect(remove).not.toHaveBeenCalled();expect(erase).not.toHaveBeenCalled();});
  it("does not upload into another company's report",async()=>{foreignCompany=true;expect((await send()).status).toBe(400);expect(upload).not.toHaveBeenCalled();});
});
