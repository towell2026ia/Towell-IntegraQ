import { beforeEach, expect, it, vi } from "vitest";
import { invitationDigest, newInvitationProof } from "@/lib/supplier-audits/invitation-proof";
import { POST } from "./route";
import { POST as issue } from "../route";
import { POST as accept } from "../accept/route";

const m = vi.hoisted(() => ({
  ticket: vi.fn(), rpc: vi.fn(), createUser: vi.fn(), asUser: vi.fn(), client: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: m.rpc, auth: { admin: { createUser: m.createUser } },
}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/rncp/server", () => ({
  RncpError: Error, rncpContext: async () => ({ supabase: {rpc: m.asUser} }),
}));
vi.mock("@/lib/supplier-audits/server", () => ({}));

const proof = newInvitationProof();
const credentials = {
  invite: proof.invite, code: proof.code, email: "contact@example.invalid", password: "local-test-secret",
};
const request = (body: object) => new Request("http://localhost", {method:"POST", body: JSON.stringify(body)});
beforeEach(() => {
  vi.resetAllMocks();
  m.rpc.mockReturnValue({maybeSingle: m.ticket});
  m.createUser.mockResolvedValue({error:null});
});

it("issues only a reservation and two separate proofs, without creating an Auth account", async () => {
  m.asUser.mockResolvedValue({data:{enroll:true}, error:null});
  const response = await issue(request({action:"invite", supplier:"s", email:credentials.email}));
  const result = await response.json();
  const url = new URL(result.path, "http://localhost");
  const invite = new URLSearchParams(url.hash.slice(1)).get("invite");
  expect(url.hash).not.toContain(result.verificationCode);
  expect(m.asUser).toHaveBeenCalledWith("iq_supplier_portal_issue", expect.objectContaining({
    p_digest: invitationDigest(invite, result.verificationCode),
  }));
  expect(m.createUser).not.toHaveBeenCalled();
});

it("rejects possession of the link alone at both steps before calling Auth", async () => {
  expect((await POST(request({...credentials, code:""}))).status).toBe(403);
  expect((await accept(request({invite:proof.invite,name:"Nombre"}))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.client).not.toHaveBeenCalled();
  expect(m.createUser).not.toHaveBeenCalled();
});

it("does not provision an account when the email or proof does not match an active invitation", async () => {
  m.ticket.mockResolvedValue({data:null,error:null});
  expect((await POST(request(credentials))).status).toBe(403);
  expect(m.createUser).not.toHaveBeenCalled();
});

it("uses the recorded email and supplier and creates an account only upon recipient submission", async () => {
  m.ticket.mockResolvedValue({data:{needs_account:true,email:credentials.email,supplier_id:"supplier-a"},error:null});
  expect((await POST(request({...credentials,supplier:"another",user_type:"administrator"}))).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("iq_supplier_portal_enrollment", {p_digest:proof.digest,p_email:credentials.email});
  expect(m.createUser).toHaveBeenCalledWith({email:credentials.email,password:credentials.password,email_confirm:true,
    app_metadata:{user_type:"supplier",supplier_enrollment:"supplier-a"}});
});

it("keeps an existing identity and its password on retry", async () => {
  m.ticket.mockResolvedValue({data:{needs_account:false,email:credentials.email,supplier_id:"supplier-a"},error:null});
  expect((await POST(request(credentials))).status).toBe(200);
  expect(m.createUser).not.toHaveBeenCalled();
});

it("activates only through the authenticated RPC with both proofs", async () => {
  m.client.mockResolvedValue({rpc:m.asUser});
  m.asUser.mockResolvedValue({error:{code:"42501"}});
  expect((await accept(request({...credentials,name:"Nombre"}))).status).toBe(403);
  expect(m.asUser).toHaveBeenCalledWith("iq_supplier_portal_accept",{p_digest:proof.digest,p_name:"Nombre"});
});
