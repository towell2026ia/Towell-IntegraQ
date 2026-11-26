import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mock = vi.hoisted(() => ({
  context: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/rncp/server", () => ({
  rncpContext: mock.context,
  RncpError: class extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
}));
vi.mock("@/lib/supplier-audits/server", () => ({}));
const request = () =>
  GET(new Request("https://integraq.test/api/suppliers/portal-access?self=1"));
describe("supplier profile projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.context.mockResolvedValue({
      supplier: true,
      profile: { external_party_id: "own", external_site_id: "north" },
      session: { authUserId: "identity" },
      supabase: { auth: { getUser: mock.getUser } },
      admin: { from: mock.from },
    });
  });
  it("rejects an unverified or mismatched identity before reading the directory", async () => {
    for (
      const identity of [{ id: "identity", email_confirmed_at: null }, {
        id: "different",
        email_confirmed_at: "2026-01-01",
      }]
    ) {
      mock.getUser.mockResolvedValue({ data: { user: identity } });
      expect((await request()).status).toBe(403);
    }
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("returns only the signed-in contact and scopes sites to the bound company and branch", async () => {
    const filters: string[] = [];
    mock.getUser.mockResolvedValue({
      data: {
        user: {
          id: "identity",
          email: "quality@example.invalid",
          email_confirmed_at: "2026-01-01",
        },
      },
    });
    mock.from.mockImplementation((table: string) => {
      const data = table === "organizations"
        ? {
          name: "Empresa",
          code: "001",
          category: "Hilo",
          metadata: {
            supplierQualityContacts: {
              contacts: [
                {
                  id: "a",
                  name: "Calidad",
                  email: "quality@example.invalid",
                  phone: "",
                  purpose: "RNCP",
                },
                {
                  id: "b",
                  name: "Interno",
                  email: "internal@example.invalid",
                  phone: "privado",
                },
              ],
            },
          },
        }
        : [{ name: "Norte" }];
      const chain = {
        select: () => chain,
        eq: (key: string, value: string) => {
          filters.push(table + "." + key + "=" + value);
          return chain;
        },
        single: () => ({ data }),
        then: (resolve: (value: unknown) => void) => resolve({ data }),
      };
      return chain;
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const result = await response.json();
    expect(result.contacts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(
      /internal@example|privado|metadata/,
    );
    expect(filters).toEqual(
      expect.arrayContaining([
        "organizations.id=own",
        "external_company_sites.company_id=own",
        "external_company_sites.id=north",
      ]),
    );
  });
});
