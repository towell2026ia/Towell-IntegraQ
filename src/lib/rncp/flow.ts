import type { RncpReport } from "@/lib/rncp-data";
import { deriveLifecycle } from "./analytics";
import { stateLabels } from "./model";
export const RNCP_CLASSIFICATIONS = ["QAC", "Hilo", "Avíos"] as const;
export type RncpClassification = typeof RNCP_CLASSIFICATIONS[number];
export function isRncpClassification(value: unknown): value is RncpClassification {
  return typeof value === "string" && RNCP_CLASSIFICATIONS.includes(value as RncpClassification);
}
export function reportOperationalState(r: RncpReport, now = new Date().toISOString()) {
  return deriveLifecycle({ id:r.id,folio:r.folio,organizationId:"",supplierId:r.supplierId??null,
    supplierName:r.supplierName??"",supplierCode:r.supplierCode??"",reportDate:r.reportDate??null,
    material:r.classification??"",defect:r.description??"",actionType:"",origin:r.origin??"legacy",
    legacyStatus:r.status,historicalStatus:r.historicalStatus??null,notifiedAt:r.notifiedAt??null,responseDeadline:r.responseDeadline??null,
    firstValidProgressAt:r.firstValidProgressAt??null,completeSubmittedAt:r.completeSubmittedAt??null,
    validatedAt:r.validatedAt??null,closedAt:r.closedAt??null,validationOutcome:r.validationOutcome??null,
    requirementsComplete:r.requirementsComplete===true,missingRequirements:[],deletedAt:r.deletedAt??null,originalFiles:[] },now).state;
}
export function reportStateLabel(r:RncpReport) {return r.status === "draft" && r.origin !== "historical" ? "Borrador" : stateLabels[reportOperationalState(r)];}
