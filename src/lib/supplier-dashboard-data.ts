export interface SupplierDashboardFilters {
  search: string;
  supplierId: string;
  siteId: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  category: string;
  lateOnly: boolean;
  pendingActionsOnly: boolean;
}

export const emptySupplierDashboardFilters: SupplierDashboardFilters = {
  search: "", supplierId: "", siteId: "", status: "", dateFrom: "", dateTo: "",
  category: "", lateOnly: false, pendingActionsOnly: false,
};

export interface SupplierDashboardMetrics {
  total: number;
  open: number;
  late: number;
  closed: number;
  closureRate: number;
  averageCloseDays: number | null;
  openActions: number;
  completedAudits: number;
  latestEvaluation: number | null;
}

export interface SupplierDashboardRow {
  id: string;
  folio: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  siteId?: string;
  siteName?: string;
  reportDate?: string;
  category?: string;
  status: "draft" | "submitted" | "in_progress" | "closed";
  late: boolean;
  findingType?: string;
  materialOrService?: string;
  responsibleName?: string;
  responseDueDate?: string;
  openActions: number;
}

export interface SupplierTimelineEvent {
  id: string;
  supplierId: string;
  supplierName: string;
  occurredAt: string;
  year: number;
  kind: "rncp" | "action" | "audit" | "evaluation";
  title: string;
  detail: string;
}

export interface SupplierDashboardOption { id: string; label: string; supplierId?: string }

export interface SupplierDashboardResult {
  metrics: SupplierDashboardMetrics;
  rows: SupplierDashboardRow[];
  timeline: SupplierTimelineEvent[];
  options: { suppliers: SupplierDashboardOption[]; sites: SupplierDashboardOption[]; categories: string[] };
}

export function supplierDashboardQuery(filters: SupplierDashboardFilters, format?: "csv" | "xlsx") {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (typeof value === "boolean") { if (value) query.set(key, "true"); }
    else if (value) query.set(key, value);
  });
  if (format) query.set("format", format);
  return query.toString();
}

export async function loadSupplierDashboard(filters: SupplierDashboardFilters) {
  const response = await fetch(`/api/suppliers/dashboard?${supplierDashboardQuery(filters)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null) as (SupplierDashboardResult & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "No fue posible consultar el dashboard de proveedores.");
  return payload;
}

export async function exportSupplierDashboard(filters: SupplierDashboardFilters, format: "csv" | "xlsx") {
  const response = await fetch(`/api/suppliers/dashboard?${supplierDashboardQuery(filters, format)}`, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "No fue posible exportar el dashboard.");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName = disposition.match(/filename=([^;]+)/i)?.[1]?.replaceAll('"', "") ?? `proveedores.${format}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click();
  URL.revokeObjectURL(url);
}
