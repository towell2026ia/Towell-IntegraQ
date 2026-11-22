import { beforeEach, expect, it, vi } from "vitest";
import { GET, PATCH, POST } from "./route";

const client = vi.hoisted(() => ({
  probe: vi.fn(), actor: vi.fn(), customer: vi.fn(), upload: vi.fn(), rpc: vi.fn(), remove: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => ({}) }));
vi.mock("@/lib/customer-portal-server", () => ({ resolveCustomerPortalActor: client.actor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: client.customer };
    return query;
  },
  storage: { from: () => ({ upload: client.upload, remove: client.remove }) }, rpc: (name: string, args: unknown) => name === "iq_u01_publication_ready_v2" ? client.probe() : client.rpc(name,args),
}) }));
function uploadRequest(customer: string) {
  const form = new FormData();
  form.set("file", new File(["%PDF-1.7 original"], "manual.pdf", { type: "application/pdf" }));
  form.set("name", "Manual");
  form.set("customerId", customer);
  return new Request("https://integraq.test/documents", { method: "POST", body: form });
}
beforeEach(() => {
  vi.resetAllMocks();
  client.probe.mockResolvedValue({data:true,error:null});
  client.actor.mockResolvedValue({ kind:"administrator", userId:"actor", workspaceId:"workspace" });
  client.customer.mockResolvedValue({ data:{id:"cliente"}, error:null });
  client.upload.mockResolvedValue({ error:null });
  client.rpc.mockResolvedValue({ data:{status:"draft"}, error:null });
});
it("T-SEG-03-01: uploads privately for the selected company and only records a draft", async () => {
  const response = await POST(uploadRequest("cliente"));
  expect(response.status).toBe(201);
  expect((await response.json()).publication.status).toBe("draft");
  expect(client.upload).toHaveBeenCalledWith(expect.stringMatching(/^customer-portal\/workspace\/cliente\//), expect.any(Buffer), {contentType:"application/pdf",upsert:false});
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith("iq_customer_portal_document_record",expect.objectContaining({p_customer_id:"cliente",p_workspace_id:"workspace"}));
});
it("denies missing recipients and prevents uploads by customers", async () => {
  client.customer.mockResolvedValue({data:null,error:null});
  expect((await POST(uploadRequest(""))).status).toBe(404);
  client.actor.mockResolvedValue({kind:"customer",companyId:"cliente",workspaceId:"workspace"});
  expect((await POST(uploadRequest("cliente"))).status).toBe(403);
  expect(client.rpc).not.toHaveBeenCalled();
  expect(client.upload).not.toHaveBeenCalled();
});
it.each(["publish","withdraw"])("passes the API command %s to the transition RPC",async action=>{
  const request = new Request("https://integraq.test/documents",{method:"PATCH",body:JSON.stringify({id:"publication",revision:2,action,reason:"prueba"})});
  expect((await PATCH(request)).status).toBe(200);
  expect(client.rpc).toHaveBeenCalledWith("iq_customer_portal_document_transition",expect.objectContaining({p_action:action,p_expected_revision:2}));
});
it("preserves an existing object after a conflicting upload",async()=>{
  client.upload.mockResolvedValue({error:{message:"exists"}});
  expect((await POST(uploadRequest("cliente"))).status).toBe(500);
  expect(client.remove).not.toHaveBeenCalled();
});

it("U01-TRANS-03 blocks catalog, upload and stale transitions before installation", async () => {
  client.probe.mockResolvedValue({data:null,error:{code:"PGRST202"}});
  const responses = [await GET(new Request("https://test/documents")), await POST(uploadRequest("cliente")), await PATCH(new Request("https://test/documents",{method:"PATCH"}))];
  for (const response of responses) {
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:"Publicación individual temporalmente no disponible"});
  }
  expect(client.rpc).not.toHaveBeenCalled();
  expect(client.upload).not.toHaveBeenCalled();
});
