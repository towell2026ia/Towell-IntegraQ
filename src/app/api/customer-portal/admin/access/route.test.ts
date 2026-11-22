import { beforeEach, afterEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({actor:vi.fn(), from:vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({createAdminClient: () => ({from:db.from})}));
vi.mock("@/lib/supabase/auth-session", () => ({getAuthenticatedSession: async () => null}));
vi.mock("@/lib/customer-portal-server", () => ({resolveCustomerPortalActor:db.actor}));
import { POST } from "./route";
const customerId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const scope = {workspace_id:"workspace",customer_id:customerId};
const request = (action: string, origin="https://fixture.test") => new Request("https://fixture.test/api/customer-portal/admin/access", {
  method:"POST", headers:{origin,"Content-Type":"application/json"}, body:JSON.stringify({action,customerId,id}),
});
function fixture(data: unknown) {
  const chain = {
    select:vi.fn().mockReturnThis(), eq:vi.fn().mockReturnThis(), match:vi.fn().mockReturnThis(),
    insert:vi.fn().mockReturnThis(), update:vi.fn().mockReturnThis(), is:vi.fn().mockReturnThis(),
    maybeSingle:vi.fn(async()=>({data})), single:vi.fn(async()=>({data})),
  };
  return chain;
}
beforeEach(() => { db.actor.mockReset().mockResolvedValue({kind:"administrator",workspaceId:"workspace",userId:"admin"}); db.from.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
it("requires same origin and an active administrator before reading or issuing access", async () => {
  expect((await POST(request("issue","https://other.test"))).status).toBe(403);
  db.actor.mockResolvedValue({kind:"customer"});
  expect((await POST(request("issue"))).status).toBe(403);
  expect(db.from).not.toHaveBeenCalled();
});
it("refuses an inaccessible company before touching access records", async () => {
  const company=fixture(null); db.from.mockReturnValue(company);
  expect((await POST(request("issue"))).status).toBe(404);
  expect(company.eq).toHaveBeenCalledWith("owning_organization_id","workspace");
  expect(company.eq).toHaveBeenCalledWith("active",true);
  expect(db.from).not.toHaveBeenCalledWith("customer_portal_links");
});
it("obtaining a missing link does not create one; revocation is scoped to the selected live grant", async () => {
  const company=fixture({id:customerId}), links=fixture(null);
  db.from.mockReturnValueOnce(company).mockReturnValueOnce(links);
  expect(await (await POST(request("obtain"))).json()).toEqual({active:false});
  expect(links.match).toHaveBeenCalledWith(scope);
  expect(links.insert).not.toHaveBeenCalled();
  const live=fixture({id});
  db.from.mockReturnValueOnce(company).mockReturnValueOnce(live);
  expect((await POST(request("revoke"))).status).toBe(200);
  expect(live.match).toHaveBeenCalledWith(scope);
  expect(live.eq).toHaveBeenCalledWith("id",id);
  expect(live.is).toHaveBeenCalledWith("revoked_at",null);
});
