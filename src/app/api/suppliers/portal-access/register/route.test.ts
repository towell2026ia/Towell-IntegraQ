import { beforeEach, expect, it, vi } from "vitest";
import { invitationDigest, invitationLocator, newInvitationProof } from "@/lib/supplier-audits/invitation-proof";
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
  RncpError: Error, rncpContext: async () => ({ supabase: {rpc: m.asUser}, profile: {user_type:"internal"}, session: {userType:"Usuario interno", workspaceMode:"production", organizationId:"local", assignedModuleIds:["supplier-portal","suppliers"], specificPermissions:{"portal_proveedores.acceder":true,"portal_proveedores.emitir_invitaciones":true,"portal_proveedores.reenviar_invitaciones":true}} }),
}));
vi.mock("@/lib/supplier-audits/server", () => ({}));

const proof = newInvitationProof();
const locator = invitationLocator(proof.invite);
const credentials = {
  invite: proof.invite, code: proof.code, email: "contact@example.invalid", password: "local-test-secret",
};
const request = (body: object) => new Request("http://localhost", {method:"POST", body: JSON.stringify(body)});
beforeEach(() => {
  vi.resetAllMocks();
  m.rpc.mockReturnValue({maybeSingle: m.ticket});
  m.client.mockResolvedValue({rpc:m.asUser,auth:{getUser:async()=>({data:{user:{id:"recipient",email:credentials.email}}})}});
  m.ticket.mockResolvedValue({data:null,error:null});
  m.createUser.mockResolvedValue({error:null});
});

it("issues only a reservation and two separate proofs, without creating an Auth account", async () => {
  m.asUser.mockResolvedValue({data:{enroll:true}, error:null});
  const response = await issue(request({action:"invite", supplier:"s", email:credentials.email}));
  const result = await response.json();
  const url = new URL(result.path, "http://localhost");
  const invite = new URLSearchParams(url.hash.slice(1)).get("invite");
  expect(url.hash).not.toContain(result.verificationCode);
  expect(m.asUser).toHaveBeenCalledWith("iq_supplier_portal_issue_selected", expect.objectContaining({
    p_replace: null,
    p_link: invitationLocator(invite), p_digest: invitationDigest(invite, result.verificationCode),
  }));
  expect(m.createUser).not.toHaveBeenCalled();
});

it("issues distinct private proofs for contacts of the same company and targets reissue by invitation", async () => {
  m.asUser.mockResolvedValue({data:{id:"new",enroll:true}, error:null});
  const first = await (await issue(request({action:"invite", supplier:"same", email:" A@example.invalid " }))).json();
  const second = await (await issue(request({action:"reissue", id:"pending", supplier:"same", email:"b@example.invalid"}))).json();
  expect(first.path).not.toEqual(second.path);
  expect(first.verificationCode).not.toEqual(second.verificationCode);
  expect(JSON.stringify(second)).not.toContain(first.verificationCode);
  expect(second.path).not.toContain(second.verificationCode);
  expect(m.asUser).toHaveBeenCalledWith("iq_supplier_portal_issue_selected", expect.objectContaining({
    p_supplier:"same", p_email:"a@example.invalid", p_replace:null,
  }));
  expect(m.asUser).toHaveBeenCalledWith("iq_supplier_portal_issue_selected", expect.objectContaining({
    p_supplier:"same", p_email:"b@example.invalid", p_replace:"pending",
  }));
});

it("charges even malformed codes against the same invitation at both steps", async () => {
  expect((await POST(request({...credentials, code:""}))).status).toBe(403);
  expect((await accept(request({invite:proof.invite,name:"Nombre"}))).status).toBe(403);
  expect(m.rpc).toHaveBeenCalledTimes(2);
  expect(m.rpc).toHaveBeenCalledWith("iq_supplier_portal_enrollment",{p_link:locator,p_digest:null,p_email:credentials.email,p_actor:"recipient"});
  expect(m.asUser).not.toHaveBeenCalled();
  expect(m.createUser).not.toHaveBeenCalled();
});

it("does not provision an account when the email or proof does not match an active invitation", async () => {
  m.ticket.mockResolvedValue({data:null,error:null});
  expect((await POST(request(credentials))).status).toBe(403);
  expect(m.createUser).not.toHaveBeenCalled();
});

it("returns the same public denial for expired, blocked, unknown and incorrect proofs", async () => {
  for (const input of [credentials, {...credentials, code:"wrong"}, {...credentials, email:"other@example.invalid"},
    {...credentials, invite:"0".repeat(64)}]) {
    const response = await POST(request(input));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({error:"Verifica tu enlace y código de invitación."});
  }
  const parameters = JSON.stringify(m.rpc.mock.calls);
  for (const secret of [proof.invite, proof.code, credentials.password]) expect(parameters).not.toContain(secret);
});

it("uses the recorded email and supplier and creates an account only upon recipient submission", async () => {
  m.ticket.mockResolvedValue({data:{needs_account:true,email:credentials.email,supplier_id:"supplier-a"},error:null});
  expect((await POST(request({...credentials,supplier:"another",user_type:"administrator"}))).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("iq_supplier_portal_enrollment", {p_link:locator,p_digest:proof.digest,p_email:credentials.email});
  expect(m.createUser).toHaveBeenCalledWith({email:credentials.email,password:credentials.password,email_confirm:true,
    app_metadata:{user_type:"supplier",supplier_enrollment:"supplier-a"}});
});

it("keeps an existing identity and its password on retry", async () => {
  m.ticket.mockResolvedValue({data:{needs_account:false,email:credentials.email,supplier_id:"supplier-a"},error:null});
  expect((await POST(request(credentials))).status).toBe(200);
  expect(m.createUser).not.toHaveBeenCalled();
});

it("activates only through the authenticated RPC with both proofs", async () => {
  m.ticket.mockResolvedValue({data:{email:credentials.email},error:null});
  m.asUser.mockResolvedValue({error:{code:"42501"}});
  expect((await accept(request({...credentials,name:"Nombre"}))).status).toBe(403);
  expect(m.asUser).toHaveBeenCalledWith("iq_supplier_portal_accept",{p_link:locator,p_name:"Nombre"});
});
