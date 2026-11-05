import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const state = vi.hoisted(() => ({
  session: null as ActiveSession | null,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  responses: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
function client() {
  return { from(table: string) {
    state.calls.push({ table, method: "from", args: [] });
    const next = () => state.responses[table]?.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order"]) {
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
const published = { id: documentId, display_name: "Manual", original_name: "manual.pdf", mime_type: "application/pdf",
  size_bytes: 12, reference_type: "external", validity_status: "current", valid_from: null, valid_until: null,
  description: null, version: 2, is_current: true, deleted_at: null, created_at: "2026-11-01T00:00:00Z" };

function setCustomer(companyId: string) {
  state.session = { ...activeSession, userType: "Cliente", workspaceMode: "production",
    authUserId: documentId,
    externalParty: { kind: "customer", companyId, companyName: `Cliente ${companyId}` } };
  state.responses.profiles = [{ data: { user_type: "customer", status: "active", workspace_mode: "production",
    external_party_kind: "customer", external_party_id: companyId }, error: null }];
  state.responses.organizations = [{ data: { id: companyId, kind: "customer", active: true, owning_organization_id: organizationId }, error: null }];
}

beforeEach(() => { state.calls = []; state.responses = {}; state.session = { ...activeSession, workspaceMode: "production" }; });

describe("customer portal shared document library", () => {
  it("returns only published, current files for the owning organization", async () => {
    setCustomer(customerA);
    state.responses.file_objects = [{ data: [published,
      { ...published, id: customerB, reference_type: "internal" },
      { ...published, id: customerB, validity_status: "not_current" },
      { ...published, id: customerB, deleted_at: "2026-11-01T00:00:00Z" },
      { ...published, id: customerB, valid_until: "2020-01-01" }], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).documents.map((row: { id: string }) => row.id)).toEqual([documentId]);
    expect(state.calls).toContainEqual({ table: "file_objects", method: "eq", args: ["workspace_id", organizationId] });
    expect(state.calls).toContainEqual({ table: "file_objects", method: "eq", args: ["reference_type", "external"] });
  });

  it("serves the same intentionally shared library to a second verified customer", async () => {
    setCustomer(customerB);
    state.responses.file_objects = [{ data: [published], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).documents).toHaveLength(1);
    expect(state.calls).toContainEqual({ table: "organizations", method: "eq", args: ["id", customerB] });
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
