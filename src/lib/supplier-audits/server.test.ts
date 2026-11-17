import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditContext } from "./server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), admin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { auditContext, auditEvent, auditSuppliers } from "./server";

describe("central supplier audit permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ authUserId: "user-A", userType: "Usuario interno", workspaceMode: "production", assignedModuleIds: ["suppliers"] });
    mocks.rpc.mockResolvedValue({ data: { organizationId: "org-A", administrator: false, canManage: false }, error: null });
  });
  it("checks fresh database permission without reading a calendar inspector assignment", async () => {
    mocks.rpc.mockResolvedValue({ data: { organizationId: "org-A", administrator: false, canManage: true }, error: null });
    expect((await auditContext("manage")).canManage).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("iq_supplier_audit_context");
  });
  it("revoked database permission blocks management despite an existing authenticated session", async () => {
    await expect(auditContext("manage")).rejects.toMatchObject({ status: 403 });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("honors fresh inherited administrator management without a second account assignment", async () => {
    mocks.session.mockResolvedValue({ authUserId: "admin-A", userType: "Administrador", workspaceMode: "production" });
    mocks.rpc.mockResolvedValue({ data: { organizationId: "org-A", administrator: true, canManage: true }, error: null });
    expect(await auditContext("manage")).toMatchObject({ canManage: true, administrator: true, organizationId: "org-A" });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("iq_supplier_audit_context");
  });
  it("does not override a database denial just because the cached session says administrator", async () => {
    mocks.session.mockResolvedValue({ authUserId: "admin-A", userType: "Administrador", workspaceMode: "production" });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "AUDIT_ACCESS_DENIED" } });
    await expect(auditContext("manage")).rejects.toMatchObject({ status: 403 });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each(["Cliente", "Proveedor"])("%s never reaches internal audit context", async userType => {
    mocks.session.mockResolvedValue({ authUserId: "external", userType, workspaceMode: "production", assignedModuleIds: ["suppliers"] });
    await expect(auditContext()).rejects.toMatchObject({ status: 403 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

function catalogContext(internalIds: string[], exactCount: number | null = internalIds.length) {
  const suppliers = [
    { id: "owned", owning_organization_id: "org-A" },
    { id: "foreign", owning_organization_id: "org-B" },
    { id: "legacy", owning_organization_id: null },
  ].map(s => ({ ...s, active: true, metadata: { privateOtherModule: "do not expose", supplierQualityContacts: { qualityName: "Synthetic" } } }));
  const ownersQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: internalIds.map(id => ({ id })), count: exactCount, error: null }) };
  const suppliersQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: suppliers, count: suppliers.length, error: null }) };
  let call = 0;
  return { organizationId: "org-A", administrator: false, admin: { from: vi.fn(() => ++call === 1 ? ownersQuery : suppliersQuery) } } as unknown as AuditContext;
}
describe("real supplier catalog scope", () => {
  it("includes existing unowned suppliers only for the sole internal organization, without owner writes", async () => {
    const suppliers = await auditSuppliers(catalogContext(["org-A"]));
    expect(suppliers.map(s => s.id)).toEqual(["owned", "legacy"]);
    expect(suppliers[1].owning_organization_id).toBeNull();
    expect(suppliers[0].metadata).toEqual({ supplierQualityContacts: { qualityName: "Synthetic" } });
  });
  it("blocks ambiguous unowned suppliers and other organizations' suppliers", async () => {
    expect((await auditSuppliers(catalogContext(["org-A", "org-B"]))).map(s => s.id)).toEqual(["owned"]);
  });
  it("does not borrow the sole organization catalog for a different actor organization", async () => {
    expect((await auditSuppliers(catalogContext(["org-B"]))).map(s => s.id)).toEqual(["owned"]);
  });
  it("fails explicitly if organization count cannot be verified", async () => {
    await expect(auditSuppliers(catalogContext(["org-A"], null))).rejects.toMatchObject({ status: 503 });
  });
});


describe("withdrawal fresh authorization and scope", () => {
 it("requires management even if the fresh profile is an administrator", async () => {
  mocks.session.mockResolvedValue({ authUserId: "admin-A", userType: "Administrador", workspaceMode: "production" });
  mocks.rpc.mockResolvedValue({ data: { organizationId: "org-A", administrator: true, canManage: false }, error: null });
  await expect(auditContext("admin")).rejects.toMatchObject({ status: 403 });
 });
 it("requires administrator even if a user can manage the calendar", async () => {
  mocks.session.mockResolvedValue({ authUserId: "internal-A", userType: "Usuario interno", workspaceMode: "production", assignedModuleIds: ["suppliers"] });
  mocks.rpc.mockResolvedValue({ data: { organizationId: "org-A", administrator: false, canManage: true }, error: null });
  await expect(auditContext("admin")).rejects.toMatchObject({ status: 403 });
 });
 it("a foreign event lookup keeps the organization predicate and returns no record", async () => {
  const filters: unknown[] = [], query = { select: vi.fn().mockReturnThis(), eq: vi.fn((k, v) => { filters.push([k, v]); return query; }), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  await expect(auditEvent({ organizationId: "org-A", admin: { from: () => query } } as unknown as AuditContext, "foreign-event")).rejects.toMatchObject({ status: 404 });
  expect(filters).toEqual([["id", "foreign-event"], ["organization_id", "org-A"]]);
 });
});
