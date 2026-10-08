export type SupplierAssessmentType = "supplier_audit" | "semiannual_evaluation" | "annual_evaluation" | "quality_evaluation" | "other";

export interface SupplierAssessment {
  id: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  siteId?: string;
  siteName?: string;
  assessmentType: SupplierAssessmentType;
  assessmentDate: string;
  evaluatorName?: string;
  score?: number;
  classification?: string;
  observations?: string;
  portalVisible: boolean;
  sourceFile?: { id: string; name: string; mimeType: string; sizeBytes: number };
  createdAt: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "No fue posible completar la operación de evaluación.");
  return payload;
}

export async function loadSupplierAssessments() {
  const response = await fetch("/api/suppliers/assessments", { cache: "no-store" });
  return parseResponse<{ assessments: SupplierAssessment[] }>(response);
}

export async function createSupplierAssessment(input: {
  supplierId: string; siteId?: string; assessmentType: SupplierAssessmentType; assessmentDate: string;
  evaluatorName?: string; score?: string; classification?: string; observations?: string;
  portalVisible: boolean; file?: File;
}) {
  const form = new FormData();
  Object.entries(input).forEach(([key, value]) => { if (key !== "file" && value !== undefined) form.set(key, String(value)); });
  if (input.file) form.set("file", input.file);
  const response = await fetch("/api/suppliers/assessments", { method: "POST", body: form });
  return parseResponse<{ assessment: SupplierAssessment }>(response);
}

export async function getSupplierAssessmentFileUrl(assessmentId: string, download = false) {
  const response = await fetch(`/api/suppliers/assessments/${encodeURIComponent(assessmentId)}/file${download ? "?download=true" : ""}`, { cache: "no-store" });
  return parseResponse<{ signedUrl: string; expiresIn: number }>(response);
}

export function supplierAssessmentTypeLabel(type: SupplierAssessmentType) {
  return { supplier_audit: "Auditoría proveedor", semiannual_evaluation: "Evaluación semestral", annual_evaluation: "Evaluación anual", quality_evaluation: "Evaluación de calidad", other: "Otro" }[type];
}
