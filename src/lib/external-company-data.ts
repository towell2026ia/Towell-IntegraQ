export type ExternalCompanyKind = "customer" | "supplier";

export interface ExternalCompanySite {
  id: string;
  companyId: string;
  code: string;
  name: string;
  address?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalCompany {
  id: string;
  code: string;
  name: string;
  kind: ExternalCompanyKind;
  active: boolean;
  category?: string;
  sites: ExternalCompanySite[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveExternalCompanyInput {
  id?: string;
  code: string;
  name: string;
  kind: ExternalCompanyKind;
  active?: boolean;
  category?: string;
}

export interface SaveExternalCompanySiteInput {
  id?: string;
  companyId: string;
  code: string;
  name: string;
  address?: string;
  active?: boolean;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "No fue posible completar la operación.");
  return payload;
}

export async function loadExternalCompanies() {
  const response = await fetch("/api/admin/external-companies", { cache: "no-store" });
  return parseResponse<{ companies: ExternalCompany[] }>(response);
}

export async function saveExternalCompany(input: SaveExternalCompanyInput) {
  const response = await fetch("/api/admin/external-companies", {
    method: input.id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity: "company", ...input }),
  });
  return parseResponse<{ company: ExternalCompany; companies: ExternalCompany[] }>(response);
}

export async function saveExternalCompanySite(input: SaveExternalCompanySiteInput) {
  const response = await fetch("/api/admin/external-companies", {
    method: input.id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity: "site", ...input }),
  });
  return parseResponse<{ site: ExternalCompanySite; companies: ExternalCompany[] }>(response);
}
