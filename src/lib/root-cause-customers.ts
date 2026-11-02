export interface RootCauseCustomer { id: string; code: string; name: string }
export interface RootCauseClaim { id: string; folio: string; title: string; external_organization_id: string }

export async function loadRootCauseCustomers(): Promise<{ customers: RootCauseCustomer[]; claims: RootCauseClaim[] }> {
  const response = await fetch("/api/root2cause/customers", { cache: "no-store" });
  const body = await response.json() as { customers?: RootCauseCustomer[]; claims?: RootCauseClaim[]; error?: string };
  if (!response.ok) throw new Error(body.error || "No fue posible consultar los clientes.");
  return { customers: body.customers ?? [], claims: body.claims ?? [] };
}
