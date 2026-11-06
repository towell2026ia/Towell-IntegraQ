export interface ResponseRequirements { containment: boolean; documents: string[]; }
export interface ResponseEvidence { fileId: string; reportId: string; actionId: string; sizeBytes: number; sha256: string; deleted: boolean; }
export interface ResponseContent {
  reportId: string; actionId: string; rootCause: string; actionPlan: string;
  containment: string; commitments: string; documentTypes: Record<string, string>;
  evidence: ResponseEvidence[];
}
export function missingResponseRequirements(content: ResponseContent, requirements: ResponseRequirements) {
  const missing: string[] = [];
  if (content.rootCause.trim().length < 10) missing.push("Análisis de causa");
  if (content.actionPlan.trim().length < 10) missing.push("Plan de acciones");
  if (requirements.containment && content.containment.trim().length < 10) missing.push("Contención");
  if (content.commitments.trim().length < 5) missing.push("Observaciones y compromisos");
  const valid = content.evidence.filter(e => e.reportId === content.reportId && e.actionId === content.actionId && e.sizeBytes > 0 && /^[a-f0-9]{64}$/i.test(e.sha256) && !e.deleted);
  if (!valid.length) missing.push("Evidencias documentales");
  if (new Set(valid.map(e => e.sha256)).size !== valid.length) missing.push("Evidencias duplicadas");
  for (const type of requirements.documents) if (!valid.some(e => content.documentTypes[type] === e.fileId)) missing.push(`Documento obligatorio: ${type}`);
  return missing;
}
