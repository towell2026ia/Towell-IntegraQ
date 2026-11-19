import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  session: vi.fn(), permission: vi.fn(),
  actor: { organization_id: "org-a", user_type: "internal", status: "active", workspace_mode: "production" },
  process: { id: "P-01", process_owner_user_id: "owner-1" },
  assignments: [{ user_id: "assigned-1" }],
  users: [
    { id: "owner-1", full_name: "Propietario de proceso", user_type: "internal", organization_id: "org-a", status: "active", workspace_mode: "production" },
    { id: "assigned-1", full_name: "Responsable asignado", user_type: "internal", organization_id: "org-a", status: "active", workspace_mode: "production" },
    { id: "other-1", full_name: "Otro proceso", user_type: "internal", organization_id: "org-a", status: "active", workspace_mode: "production" },
    { id: "admin-1", full_name: "Administradora", user_type: "administrator", organization_id: "org-a", status: "active", workspace_mode: "production" },
    { id: "other-org", full_name: "Otra organización", user_type: "internal", organization_id: "org-b", status: "active", workspace_mode: "production" },
  ],
}));

vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: mock.session }));
vi.mock("@/lib/module-permissions", () => ({ canPerformModuleAction: mock.permission }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const state: Record<string, unknown> = {};
  const builder = {
    select: () => builder, eq: (key: string, value: unknown) => { state[key] = value; return builder; },
    in: (key: string, value: unknown) => { state[key] = value; return builder; }, order: () => builder,
    maybeSingle: async () => ({ data: table === "profiles" ? mock.actor : mock.process, error: null }),
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({
      data: table === "user_process_permissions" ? mock.assignments : table === "profiles" && state.user_type ? mock.users.filter(user =>
        (state.organization_id === undefined || user.organization_id === state.organization_id) &&
        (state.status === undefined || user.status === state.status) &&
        (state.workspace_mode === undefined || user.workspace_mode === state.workspace_mode) &&
        (Array.isArray(state.user_type) ? state.user_type.includes(user.user_type) : user.user_type === state.user_type),
      ) : [], error: null,
    }).then(resolve),
  };
  return builder;
} }) }));

import { GET } from "./route";

beforeEach(() => {
  mock.session.mockReset().mockResolvedValue({ authUserId: "actor", userType: "Usuario interno", workspaceMode: "production", assignedProcessIds: ["P-01"] });
  mock.permission.mockReturnValue(true);
});

it("returns only same-organization active internal users authorized for the requested process", async () => {
  const response = await GET(new Request("https://integraq.test/api/root2cause/responsible-users?processId=P-01"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ users: [
    { id: "owner-1", fullName: "Propietario de proceso" },
    { id: "assigned-1", fullName: "Responsable asignado" },
    { id: "admin-1", fullName: "Administradora" },
  ] });
});

it("rejects external users and users without Root2Cause view permission", async () => {
  mock.session.mockResolvedValueOnce({ authUserId: "external", userType: "Proveedor" });
  expect((await GET(new Request("https://integraq.test/api/root2cause/responsible-users"))).status).toBe(403);
  mock.permission.mockReturnValue(false);
  expect((await GET(new Request("https://integraq.test/api/root2cause/responsible-users"))).status).toBe(403);
});

it("rejects a process outside the actor's process scope", async () => {
  expect((await GET(new Request("https://integraq.test/api/root2cause/responsible-users?processId=P-99"))).status).toBe(403);
});
