import type { OrganizationPosition } from "@/lib/organization-data";

export async function loadOrganizationPositions(): Promise<OrganizationPosition[]> {
  const response = await fetch("/api/organization/positions", {
    cache: "no-store",
  });
  const body = await response.text();
  let payload: { positions?: OrganizationPosition[]; error?: string } = {};
  try {
    payload = body ? JSON.parse(body) as typeof payload : {};
  } catch {
    throw new Error("El servidor devolvió una respuesta inválida al cargar los puestos.");
  }
  if (!response.ok || !payload.positions) {
    throw new Error(payload.error ?? "No fue posible cargar los puestos desde Supabase.");
  }
  return payload.positions;
}

export const positionsChangedEvent = "integraq:positions-changed";
