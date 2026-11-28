import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), scoped: vi.fn(), selection: vi.fn() }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => ({ authUserId: "admin-A", userType: "Administrador", organizationId: "workspace", workspaceMode: "production" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.admin }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.scoped, rpc: async (name:string) => ({data:name==="iq_rncp_actor_org" ? "workspace" : [{id:"supplier-A",code:"QA-001",name:"Proveedor QA",active:true}],error:null}) }) }));
import { GET } from "@/app/api/suppliers/dashboard/route";
function query(data: unknown[]) {
 const q = { select: vi.fn((...args) => { mocks.selection(...args); return q; }), in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) }; return q;
}
describe("dashboard retirement integration", () => {
 beforeEach(() => vi.resetAllMocks());
 it("excludes withdrawn assessments from actual metrics/timeline while retaining unrelated evaluations", async () => {
  const make = (id: string, audit_event_id: string | null, withdrawn_at: string | null, score: number) => ({ id, supplier_id: "supplier-A", site_id: null, assessment_type: "supplier_audit", assessment_date: "2026-11-10", score, classification: null, audit_event_id, audit_event: audit_event_id ? { id: audit_event_id, withdrawn_at } : null });
  const assessments = [make("active", "event-A", null, 80), make("retired", "event-R", "2026-11-10T12:00:00Z", 99), make("legacy", null, null, 90)];
  const before = structuredClone(assessments);
  mocks.admin.mockImplementation((table: string) => query(table === "organizations" ? [{ id: "supplier-A", code: "QA-001", name: "Proveedor QA", active: true }] : []));
  mocks.scoped.mockImplementation((table:string) => query(table==="supplier_assessments"?assessments:[]));
  const response = await GET(new Request("http://localhost/api/suppliers/dashboard")); expect(response.status).toBe(200);
  const result = await response.json(); expect(result.metrics.completedAudits).toBe(2); expect(result.timeline.map((e: { id: string }) => e.id)).not.toContain("retired"); expect(result.timeline).toHaveLength(2);
  expect(assessments).toEqual(before); expect(mocks.scoped).toHaveBeenCalledWith("supplier_assessments"); expect(mocks.admin).not.toHaveBeenCalledWith("supplier_assessments");
  expect(mocks.selection).toHaveBeenCalledWith(expect.stringContaining("audit_event:supplier_audit_events(*)"));
 });
});
