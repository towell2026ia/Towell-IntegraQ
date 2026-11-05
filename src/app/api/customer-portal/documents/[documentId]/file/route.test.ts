import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const state = vi.hoisted(() => ({
  session: null as ActiveSession | null,
  responses: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  signedPath: "",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from(table: string) {
    state.calls.push({ table, method: "from", args: [] });
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is"]) chain[method] = (...args: unknown[]) => { state.calls.push({ table, method, args }); return chain; };
    chain.maybeSingle = async () => state.responses[table]?.shift() ?? { data: null, error: null };
    return chain;
  },
  storage: { from: () => ({ createSignedUrl: async (path: string) => { state.signedPath = path; return { data: { signedUrl: "https://storage.example/signed" }, error: null }; } }) },
}) }));

import { GET } from "./route";

const customerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const documentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const baseDocument = { id: documentId, bucket_id: "integraq-private", object_path: "private/doc.pdf", original_name: "doc.pdf",
  reference_type: "external", validity_status: "current", valid_from: null, valid_until: null, is_current: true,
  deleted_at: null, resource_type: "general_information_document", workspace_id: organizationId };

function asCustomer() {
  state.session = { ...activeSession, userType: "Cliente", authUserId: customerId, workspaceMode: "production",
    externalParty: { kind: "customer", companyId: customerId, companyName: "Cliente A" } };
}

beforeEach(() => {
  state.calls = []; state.signedPath = ""; state.responses = {
    profiles: [{ data: { user_type: "customer", status: "active", workspace_mode: "production", external_party_kind: "customer", external_party_id: customerId }, error: null }],
    organizations: [{ data: { id: customerId, kind: "customer", active: true, owning_organization_id: organizationId }, error: null }],
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
    expect(state.signedPath).toBe("private/doc.pdf");
  });

  it("does not sign unpublished or noncurrent files for customers", async () => {
    state.responses.file_objects = [{ data: { ...baseDocument, reference_type: "internal" }, error: null }];
    const result = await GET(new Request("https://integraq.test/api/customer-portal/documents/file"), { params: Promise.resolve({ documentId }) });
    expect(result.status).toBe(404);
    expect(state.signedPath).toBe("");
  });

  it("rejects a supplier before querying or signing customer documents", async () => {
    state.session = { ...state.session!, userType: "Proveedor", externalParty: { kind: "supplier", companyId: customerId, companyName: "Proveedor" } };
    const result = await GET(new Request("https://integraq.test/api/customer-portal/documents/file"), { params: Promise.resolve({ documentId }) });
    expect(result.status).toBe(403);
    expect(state.calls.filter(call => call.table === "file_objects")).toHaveLength(0);
    expect(state.signedPath).toBe("");
  });
});
