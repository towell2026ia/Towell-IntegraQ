import { beforeEach, afterEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({actor:vi.fn(), rpc:vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({createClient: async () => ({rpc:db.rpc})}));
vi.mock("@/lib/supabase/auth-session", () => ({getAuthenticatedSession: async () => null}));
vi.mock("@/lib/customer-portal-server", () => ({resolveCustomerPortalActor:db.actor}));
import { POST } from "./route";
const customerId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";

const request = (action: string, origin="https://fixture.test") => new Request("https://fixture.test/api/customer-portal/admin/access", {
  method:"POST", headers:{origin,"Content-Type":"application/json"}, body:JSON.stringify({action,customerId,id}),
});
beforeEach(() => { db.actor.mockReset().mockResolvedValue({kind:"administrator",workspaceId:"workspace",userId:"admin"}); db.rpc.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
it("requires same origin and an internal actor", async () => {
  expect((await POST(request("issue","https://other.test"))).status).toBe(403);
  db.actor.mockResolvedValue({kind:"customer"});
  expect((await POST(request("issue"))).status).toBe(403);
  expect(db.rpc).not.toHaveBeenCalled();
});
it("denies a customer outside the database scope", async () => {
  db.rpc.mockResolvedValue({error:{code:"42501"}});
  expect((await POST(request("status"))).status).toBe(403);
});
it("exposes only status and keeps consultation independent from withdrawal", async () => {
  db.actor.mockResolvedValue({kind:"internal",invitations:{consultar:true}});
  db.rpc.mockResolvedValue({data:{active:true,id,nonce:"private",key_digest:"private"}});
  expect(await (await POST(request("status"))).json()).toEqual({active:true,id});
  expect((await POST(request("revoke"))).status).toBe(403);
  expect(db.rpc).toHaveBeenCalledTimes(1);
});
it("passes the exact company and live invitation to the transaction", async () => {
  db.rpc.mockResolvedValue({data:{active:false}});
  expect(await (await POST(request("obtain"))).json()).toEqual({active:false});
  expect((await POST(request("revoke"))).status).toBe(200);
  expect(db.rpc).toHaveBeenLastCalledWith("iq_customer_invitation_command",{p_customer:customerId,p_action:"revoke",p_id:id,p_nonce:null,p_digest:null});
});
