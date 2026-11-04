import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const state = vi.hoisted(() => ({
  session: null as ActiveSession | null,
  profile: null as { organization_id: string | null; user_type: string; status: string } | null,
  tables: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: async () => state.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from(table: string) {
    state.tables.push(table);
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: state.profile, error: null }),
    };
    return query;
  },
}) }));

import { GET as listGeneralInformation } from "@/app/api/information-general/route";
import { GET as openGeneralInformationFile } from "@/app/api/information-general/documents/[documentId]/file/route";
import { GeneralInformationApiError, requireGeneralInformationActor } from "@/lib/general-information-server";

const organizationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const actorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  state.tables = [];
  state.session = { ...activeSession, authUserId: actorId, userType: "Usuario interno", workspaceMode: "production" };
  state.profile = { organization_id: organizationId, user_type: "internal", status: "active" };
});

describe("General Information external isolation", () => {
  it("denies direct list and file API calls for customer A, customer B and supplier before privileged file queries", async () => {
    for (const [userType, role, companyId] of [
      ["Cliente", "customer", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      ["Cliente", "customer", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      ["Proveedor", "supplier", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
    ] as const) {
      state.session = { ...state.session!, userType,
        externalParty: { kind: role, companyId, companyName: "Empresa externa" } };
      state.profile = { organization_id: null, user_type: role, status: "active" };
      state.tables = [];
      const list = await listGeneralInformation(new Request("https://integraq.test/api/information-general"));
      const file = await openGeneralInformationFile(
        new Request("https://integraq.test/api/information-general/documents/file-id/file"),
        { params: Promise.resolve({ documentId: "file-id" }) },
      );
      expect(list.status).toBe(403);
      expect(file.status).toBe(403);
      expect(state.tables).toEqual(["profiles", "profiles"]);
    }
  });

  it("accepts an active internal viewer and administrator in their own workspace", async () => {
    expect(await requireGeneralInformationActor()).toEqual({ id: actorId, workspaceId: organizationId, administrator: false });
    state.session = { ...state.session!, userType: "Administrador" };
    state.profile = { organization_id: organizationId, user_type: "administrator", status: "active" };
    expect(await requireGeneralInformationActor(true)).toEqual({ id: actorId, workspaceId: organizationId, administrator: true });
  });

  it("rejects a session/profile role mismatch or inactive profile", async () => {
    state.session = { ...state.session!, userType: "Cliente" };
    await expect(requireGeneralInformationActor()).rejects.toMatchObject({ status: 403 } satisfies Partial<GeneralInformationApiError>);
    state.session = { ...state.session!, userType: "Usuario interno" };
    state.profile = { organization_id: organizationId, user_type: "internal", status: "inactive" };
    await expect(requireGeneralInformationActor()).rejects.toMatchObject({ status: 403 } satisfies Partial<GeneralInformationApiError>);
    state.session = { ...state.session!, userType: "Administrador" };
    state.profile = { organization_id: organizationId, user_type: "internal", status: "active" };
    await expect(requireGeneralInformationActor()).rejects.toMatchObject({ status: 403 } satisfies Partial<GeneralInformationApiError>);
    state.session = { ...state.session!, userType: "Usuario interno" };
    state.profile = { organization_id: null, user_type: "internal", status: "active" };
    await expect(requireGeneralInformationActor()).rejects.toMatchObject({ status: 403 } satisfies Partial<GeneralInformationApiError>);
    expect(state.tables).not.toContain("organizations");
  });
});
