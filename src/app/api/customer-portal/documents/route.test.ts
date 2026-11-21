import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const state = vi.hoisted(() => ({
  session: null as ActiveSession | null,
  certificates: vi.fn(),
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  responses: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
vi.mock("@/lib/certification-portal-server", () => ({ publishedCertificationFiles: state.certificates }));
function client() {
  return { from(table: string) {
    state.calls.push({ table, method: "from", args: [] });
    const next = () => state.responses[table]?.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "range", "in"]) {
      chain[method] = (...args: unknown[]) => { state.calls.push({ table, method, args }); return chain; };
    }
    chain.maybeSingle = async () => next();
    chain.then = (resolve: (value: unknown) => unknown) => resolve(next());
    return chain;
  } };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client() }));

import { GET } from "./route";

const customerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const customerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const documentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
function setCustomer(companyId: string) {
  state.session = { ...activeSession, userType: "Cliente", workspaceMode: "production",
    authUserId: documentId,
    externalParty: { kind: "customer", companyId, companyName: `Cliente ${companyId}` } };
  state.responses.profiles = [{ data: { user_type: "customer", status: "active", workspace_mode: "production",
    external_party_kind: "customer", external_party_id: companyId }, error: null }];
  state.responses.organizations = [{ data: { id: companyId, kind: "customer", active: true, owning_organization_id: organizationId }, error: null }];
}

beforeEach(() => { state.certificates.mockReset().mockResolvedValue([]); state.calls = []; state.responses = {}; state.session = { ...activeSession, workspaceMode: "production" }; });

describe("customer portal individual publications", () => {
  it("returns only publications linked to the authenticated customer and workspace", async () => {
    setCustomer(customerA);
    state.responses.customer_portal_document_publications = [{ data: [{ id: documentId, workspace_id: organizationId, customer_id: customerA, file_id: documentId,
      display_name: "Manual", description: null, version: 1, status: "published", published_at: "2026-11-01T00:00:00Z" }], error: null }];
    state.responses.file_objects = [{ data: [{ id: documentId, resource_id: documentId, bucket_id: "integraq-private", object_path: `customer-portal/${organizationId}/${customerA}/manual.pdf`, original_name: "manual.pdf", mime_type: "application/pdf", size_bytes: 12,
      workspace_id: organizationId, external_organization_id: customerA, resource_type: "customer_portal_document", deleted_at: null }], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).documents.map((row: { id: string }) => row.id)).toEqual([documentId]);
    expect(state.calls).toContainEqual({ table: "customer_portal_document_publications", method: "eq", args: ["customer_id", customerA] });
    expect(state.calls).toContainEqual({ table: "file_objects", method: "eq", args: ["external_organization_id", customerA] });
    expect(state.calls.some(call => call.table === "file_objects" && call.args.includes("general_information_document"))).toBe(false);
  });

  it("does not expose internal documents or globally published information documents", async () => {
    setCustomer(customerB);
    state.responses.customer_portal_document_publications = [{ data: [], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).documents).toHaveLength(0);
    expect(state.calls.some(call => call.table === "file_objects" && call.args.includes("general_information_document"))).toBe(false);
  });

  it("denies suppliers before querying files", async () => {
    state.session = { ...activeSession, userType: "Proveedor", workspaceMode: "production",
      externalParty: { kind: "supplier", companyId: customerA, companyName: "Proveedor" } };
    state.responses.profiles = [{ data: { user_type: "supplier", status: "active", workspace_mode: "production",
      external_party_kind: "supplier", external_party_id: customerA }, error: null }];
    expect((await GET()).status).toBe(403);
    expect(state.calls.filter(call => call.table === "file_objects")).toHaveLength(0);
  });
});

it("T-SEG-01-01 / T-SEG-01-02: selects the session recipient from mixed rows", async () => {
  for (const companyId of [customerA, customerB]) {
    setCustomer(companyId);
    const companies = [customerA, customerB];
    state.responses.customer_portal_document_publications = [{ data: companies.map(id => ({
      id, workspace_id: organizationId, customer_id: id, file_id: id, status: "published",
    })), error: null }];
    state.responses.file_objects = [{ data: companies.map(id => ({
      id, resource_id: id, workspace_id: organizationId, external_organization_id: id,
      object_path: `customer-portal/${organizationId}/${id}/manual.pdf`, bucket_id: "integraq-private",
      resource_type: "customer_portal_document", deleted_at: null,
    })), error: null }];
    const body = await (await GET()).json();
    expect(body.documents.map((row: {id: string}) => row.id)).toEqual([companyId]);
  }
});
it("T-SEG-01-03 / T-SEG-03-02: excludes unassigned and internal records", async () => {
  setCustomer(customerA);
  state.responses.customer_portal_document_publications = [{ data: [
    { id: documentId, file_id: documentId, workspace_id: organizationId, customer_id: null, status: "published" },
    { id: customerA, file_id: customerA, workspace_id: organizationId, customer_id: customerA, status: "published" },
  ], error: null }];
  state.responses.file_objects = [{ data: [documentId, customerA].map(id => ({ id, resource_id: id,
    workspace_id: organizationId, external_organization_id: customerA, resource_type: "general_information_document",
    bucket_id: "integraq-private", deleted_at: null, object_path: "internal/original.pdf" })), error: null }];
  expect((await (await GET()).json()).documents).toEqual([]);
});
it("keeps authorized certifications when the publications contract is missing", async () => {
  setCustomer(customerA);
  state.responses.customer_portal_document_publications = [{ data: null, error: { code: "missing" } }];
  state.certificates.mockResolvedValue([{ id: "cert-only", certification_name: "Certificado" }]);
  const body = await (await GET()).json();
  expect(body.documents.map((row: {id:string}) => row.id)).toEqual(["cert-only"]);
  expect(body.sectionErrors.documents).toBeTruthy();
  expect(body.sectionErrors.certifications).toBeNull();
});
it("reports certification failure without masking the documentary result", async () => {
  setCustomer(customerA);
  state.certificates.mockRejectedValue(new Error("isolated failure"));
  state.responses.customer_portal_document_publications = [{data:[{id:documentId,file_id:documentId,workspace_id:organizationId,customer_id:customerA,status:"published"}],error:null}];
  state.responses.file_objects = [{data:[{id:documentId,resource_id:documentId,bucket_id:"integraq-private",object_path:`customer-portal/${organizationId}/${customerA}/file.pdf`,workspace_id:organizationId,external_organization_id:customerA,resource_type:"customer_portal_document",deleted_at:null}],error:null}];
  const body = await (await GET()).json();
  expect(body.sectionErrors.documents).toBeNull();
  expect(body.sectionErrors.certifications).toBeTruthy();
  expect(body.documents.map((doc:{id:string})=>doc.id)).toEqual([documentId]);
});
