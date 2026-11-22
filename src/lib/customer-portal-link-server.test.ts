import { afterEach, describe, expect, it, vi } from "vitest";
import { newPortalKey, portalDigest, portalKey, resolvePortalLink } from "./customer-portal-link-server";
const state = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({createAdminClient: () => ({rpc: state.rpc})}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("company entry credentials", () => {
  it("reproduces a selected company's QR until revocation and stores a verifier", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "isolated-fixture");
    const first = newPortalKey("A");
    const key = portalKey("A", first.nonce);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(portalDigest(key)).toBe(first.key_digest);
    expect(portalKey("B", first.nonce)).not.toBe(key);
    expect(newPortalKey("A")).not.toEqual(first);
    expect(Object.values(first)).not.toContain(key);
  });
  it("checks the verifier on each request, including after revocation", async () => {
    const token = "z".repeat(43);
    const row = {grant_id: "grant", workspace_id: "workspace", customer_id: "A", company_name: "Company A"};
    const read = vi.fn().mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:null});
    state.rpc.mockReturnValue({maybeSingle: read});
    const request = new Request("https://fixture.test", {headers:{authorization:"Bearer "+token}});
    expect(await resolvePortalLink(request)).toMatchObject({companyId:"A", userId:null, linkId:"grant"});
    expect(await resolvePortalLink(request)).toBeNull();
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(state.rpc).toHaveBeenCalledWith("iq_customer_portal_access", {p_digest:portalDigest(token),p_bucket:expect.any(Number)});
  });
  it("routes missing or malformed credentials through the same limiter and ignores an internal cookie", async () => {
    state.rpc.mockReturnValue({maybeSingle: async () => ({data:null})});
    for (const value of ["", "Bearer customer-id"]) {
      expect(await resolvePortalLink(new Request("https://fixture.test", {headers:{authorization:value,cookie:"fixture=internal"}}))).toBeNull();
    }
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(state.rpc).toHaveBeenCalledWith("iq_customer_portal_access", {p_digest:null,p_bucket:expect.any(Number)});
  });
});
