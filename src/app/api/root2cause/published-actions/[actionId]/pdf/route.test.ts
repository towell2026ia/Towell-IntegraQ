import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as unknown, admin: vi.fn(), rpc: vi.fn(), from: vi.fn(), bucket: vi.fn() }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => mocks.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, from: mocks.from, storage: { from: mocks.bucket } }) }));

import { GET, POST } from "./route";

describe("Root2Cause official PDF API guard", () => {
  beforeEach(() => { mocks.session = null; mocks.admin.mockReset(); });

  it("rejects an invalid action ID before database access", async () => {
    const response = await GET(new Request("https://integraq.test"), { params: Promise.resolve({ actionId: "invalid" }) });
    expect(response.status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("requires an authenticated internal actor for reading or generating a PDF", async () => {
    const context = { params: Promise.resolve({ actionId: "c9d62a40-bbc9-48dc-9415-6020721261df" }) };
    expect((await GET(new Request("https://integraq.test"), context)).status).toBe(403);
    expect((await POST(new Request("https://integraq.test", { method: "POST" }), context)).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});

it("T-RCA-07-02 checks current case access before listing, generating or signing a PDF", async () => {
  const actionId="c9d62a40-bbc9-48dc-9415-6020721261df";
  const context={params:Promise.resolve({actionId})};
  mocks.session={authUserId:"former",userType:"Usuario interno",workspaceMode:"production",assignedModuleIds:["corrective-actions"],
    moduleActionPermissions:[{moduleId:"corrective-actions",action:"view"}]};
  mocks.rpc.mockResolvedValue({data:false,error:null});mocks.admin.mockClear();
  const request=new Request("https://integraq.test/?fileId="+actionId);
  for(const handler of [GET,POST]) {
    const response=await handler(request,context);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("signedUrl");
  }
  expect(mocks.rpc).toHaveBeenCalledWith("iq_u08_read_case",{p_action:actionId});
  expect(mocks.admin).not.toHaveBeenCalled();
});

it.each([true, false])("uses the session's Storage decision at signing time (allowed=%s)", async allowed => {
  const actionId = "c9d62a40-bbc9-48dc-9415-6020721261df";
  const context = { params: Promise.resolve({ actionId }) };
  const bytes = new Blob(["PDF fixture"]);
  const file = { id: actionId, bucket_id: "integraq-private", object_path: "fixture.pdf",
    original_name: "A3.pdf", sha256: createHash("sha256").update("PDF fixture").digest("hex") };
  function query(data: unknown) {
    const result = Promise.resolve({ data, error: null });
    const chain = { select: () => chain, eq: () => chain, is: () => chain,
      maybeSingle: () => result, then: result.then.bind(result) };
    return chain;
  }
  mocks.session = { authUserId: "reviewer", userType: "Usuario interno", workspaceMode: "production",
    assignedModuleIds: ["corrective-actions"], moduleActionPermissions: [{ moduleId: "corrective-actions", action: "view" }] };
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.admin.mockReturnValue({ from: () => query({ organization_id: "org", user_type: "internal", status: "active", workspace_mode: "production" }) });
  mocks.from.mockImplementation(table => query(table === "corrective_actions" ? { id: actionId } : [file]));
  const sign = vi.fn().mockResolvedValue(allowed ? { data: { signedUrl: "fixture-only" } } : { error: { message: "denied" } });
  mocks.bucket.mockReturnValue({ download: async () => ({ data: bytes }), createSignedUrl: sign });
  const response = await GET(new Request("https://integraq.test/?fileId="+actionId), context);
  expect(sign).toHaveBeenCalledWith("fixture.pdf", 60, { download: "A3.pdf" });
  expect(response.status).toBe(allowed ? 200 : 503);
  expect((await response.json()).signedUrl).toBe(allowed ? "fixture-only" : undefined);
});
