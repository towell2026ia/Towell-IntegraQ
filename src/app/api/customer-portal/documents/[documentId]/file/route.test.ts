import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const state = vi.hoisted(() => ({
  session: null as ActiveSession | null,
  responses: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  signedPath: "",
  expiresAt: 0,
  signature: {} as {ttl?:number; options?: unknown},
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async () => ({data:true,error:null}),
  from(table: string) {
    state.calls.push({ table, method: "from", args: [] });
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "neq", "insert"]) chain[method] = (...args: unknown[]) => { state.calls.push({ table, method, args }); return chain; };
    chain.maybeSingle = async () => state.responses[table]?.shift() ?? { data: null, error: null };
    chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null });
    return chain;
  },
  storage: { from: () => ({ createSignedUrl: async (path: string, ttl:number, options:unknown) => { state.expiresAt = Date.now() + ttl * 1000; state.signature={ttl,options}; state.signedPath = path; return { data: { signedUrl: "https://storage.example/signed" }, error: null }; } }) },
}) }));

import { GET } from "./route";

const customerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const documentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const publication = { id: documentId, file_id: documentId, customer_id: customerId, workspace_id: organizationId, status: "published" };
const baseDocument = { id: documentId, bucket_id: "integraq-private", resource_id: documentId, object_path: `customer-portal/${organizationId}/${customerId}/doc.pdf`, original_name: "doc.pdf",
  deleted_at: null, resource_type: "customer_portal_document", workspace_id: organizationId, external_organization_id: customerId };

function asCustomer() {
  state.session = { ...activeSession, userType: "Cliente", authUserId: customerId, workspaceMode: "production",
    externalParty: { kind: "customer", companyId: customerId, companyName: "Cliente A" } };
}

beforeEach(() => {
  state.calls = []; state.signedPath = ""; state.responses = {
    profiles: [{ data: { user_type: "customer", status: "active", workspace_mode: "production", external_party_kind: "customer", external_party_id: customerId }, error: null }],
    organizations: [{ data: { id: customerId, kind: "customer", active: true, owning_organization_id: organizationId }, error: null }],
    customer_portal_document_publications: [{ data: { ...publication }, error: null }],
    file_objects: [{ data: { ...baseDocument }, error: null }],
  };
  asCustomer();
  state.calls = [];
});

describe("customer portal private file authorization", () => {
  it("redirects a verified customer to a short-lived signed URL for a published document", async () => {
    state.calls = [];
    // Profile and organization are provided by the resolver's successive privileged reads.
    const result = await GET(new Request("https://integraq.test/api/customer-portal/documents/file"), { params: Promise.resolve({ documentId }) });
    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe("https://storage.example/signed");
    expect(state.signedPath).toBe(baseDocument.object_path);
  });

  it("does not sign a missing publication for customers", async () => {
    state.responses.customer_portal_document_publications = [{ data: null, error: null }];
    const result = await GET(new Request("https://integraq.test/api/customer-portal/documents/file"), { params: Promise.resolve({ documentId }) });
    expect(result.status).toBe(404);
    expect(state.signedPath).toBe("");
  });

  it("never signs a publication for a different customer", async () => {
    state.responses.customer_portal_document_publications = [{ data: { ...publication, customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, error: null }];
    const result = await GET(new Request("https://integraq.test/api/customer-portal/documents/file"), { params: Promise.resolve({ documentId }) });
    expect(result.status).toBe(404);
    expect(state.signedPath).toBe("");
  });

  it("rejects a supplier before querying or signing customer documents", async () => {
    state.session = { ...state.session!, userType: "Proveedor", externalParty: { kind: "supplier", companyId: customerId, companyName: "Proveedor" } };
    const result = await GET(new Request("https://integraq.test/api/customer-portal/documents/file"), { params: Promise.resolve({ documentId }) });
    expect(result.status).toBe(403);
    expect(state.calls.filter(call => call.table === "customer_portal_document_publications" || call.table === "file_objects")).toHaveLength(0);
    expect(state.signedPath).toBe("");
  });
});

it("T-SEG-02-01 / T-SEG-02-03: authorized preview and foreign recipient denial", async () => {
  const open = () => GET(new Request("https://integraq.test/file"), { params: Promise.resolve({documentId}) });
  expect((await open()).status).toBe(302);
  expect(state.signature).toMatchObject({ttl:60, options:{download:false}});
  state.responses.profiles = [{data:{user_type:"customer",status:"active",workspace_mode:"production",external_party_kind:"customer",external_party_id:customerId},error:null}];
  state.responses.organizations = [{data:{id:customerId,kind:"customer",active:true,owning_organization_id:organizationId},error:null}];
  state.responses.customer_portal_document_publications = [{data:{...publication,customer_id:organizationId},error:null}];
  state.responses.file_objects = [{data:baseDocument,error:null}];
  state.signedPath="";
  expect((await open()).status).toBe(404);
  expect(state.signedPath).toBe("");
});
it("T-SEG-02-02: an unlinked file or wrong bucket never receives a download signature", async () => {
  state.responses.file_objects = [{data:{...baseDocument,bucket_id:"unrelated"},error:null}];
  const result = await GET(new Request("https://integraq.test/file?disposition=download"), {params:Promise.resolve({documentId})});
  expect(result.status).toBe(404);
  expect(state.signedPath).toBe("");
});
it("T-SEG-02-04: withdrawal denies a new download and preissued URL has a bounded TTL", async () => {
  const open = () => GET(new Request("https://integraq.test/file?disposition=download"), {params:Promise.resolve({documentId})});
  vi.useFakeTimers();
  try {
  const profiles = state.responses.profiles[0], org = state.responses.organizations[0];
  expect((await open()).status).toBe(302);
  expect(state.signature).toEqual({ttl:60,options:{download:"doc.pdf"}});
  state.responses.profiles=[profiles]; state.responses.organizations=[org];
  state.responses.customer_portal_document_publications=[{data:{...publication,status:"withdrawn"},error:null}];
  state.responses.file_objects=[{data:baseDocument,error:null}];
  state.signedPath="";
  expect((await open()).status).toBe(404);
  expect(state.signedPath).toBe("");
  expect(Date.now()).toBeLessThan(state.expiresAt);
  vi.advanceTimersByTime(60000);
  expect(Date.now()).toBeGreaterThanOrEqual(state.expiresAt);
  } finally { vi.useRealTimers(); }
});
