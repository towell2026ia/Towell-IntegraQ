import type { ActiveSession } from "@/lib/session-data";
import type { MeasurementAsset } from "@/lib/types";

export type MetrologyReportTemplate = "F-CA-51" | "F-CA-53" | "CALIBRATION";
export type MetrologyResult = "accepted" | "conditional" | "rejected";
export type InspectionResult = "accepted" | "not_accepted" | "na";

export interface ScaleVerificationValues {
  periodicity: string;
  inspector: string;
  visual: Record<string, InspectionResult>;
  stabilization: string[];
  eccentricityLoad: string;
  eccentricity: string[];
  repeatability: string[];
  indication: Array<{ reading: string; nominal: string; ascending: string }>;
  standards: string;
  observations: string;
}

export interface LengthVerificationValues {
  periodicity: string;
  inspector: string;
  visual: Record<string, InspectionResult>;
  initialTemperature: string;
  initialHumidity: string;
  finalTemperature: string;
  finalHumidity: string;
  units: string;
  measurements: Array<{ dimension: string; first: string; second: string; third: string; average: string }>;
  observations: string;
}

export interface CalibrationValues {
  provider: string;
  certificate: string;
  scope: string;
  uncertainty: string;
  observations: string;
}

export interface MetrologyReport {
  id: string;
  assetId: string;
  assetCode: string;
  template: MetrologyReportTemplate;
  completedAt: string;
  nextDueDate: string;
  result: MetrologyResult;
  performedBy: string;
  performedByUserId: string;
  signedAt: string;
  signatureDataUrl?: string;
  values: ScaleVerificationValues | LengthVerificationValues | CalibrationValues;
  createdAt: string;
}

export interface MetrologyWorkspaceState {
  assets: MeasurementAsset[];
  reports: MetrologyReport[];
}

export const scaleInspectionItems = ["Funciones", "Pantalla", "Batería / Eliminador", "Desplazamiento de escala", "Tipo de plato redondo / poligonal"] as const;
export const lengthInspectionItems = ["Tope fijo", "Husillo", "Trinquete", "Freno", "Cuerpo", "Cilindro", "Tambor", "Desplazamiento"] as const;
export const inspectionLabels: Record<InspectionResult, string> = { accepted: "✓ Aceptable", not_accepted: "X No aceptable", na: "N/A No aplica" };

export function getMetrologyReportTemplate(asset: MeasurementAsset): MetrologyReportTemplate {
  if (asset.activity === "calibration") return "CALIBRATION";
  const source = [asset.measurementCategory, asset.measurementType, asset.name].filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  return /longitud|flexometro|cinta metrica|regla/.test(source) ? "F-CA-53" : "F-CA-51";
}

export function getMetrologyTemplateName(template: MetrologyReportTemplate) {
  if (template === "F-CA-51") return "Reporte de Verificación de Básculas · Rev. 1";
  if (template === "F-CA-53") return "Reporte de Verificación de Flexómetros y Cintas Métricas · Rev. 0";
  return "Informe de calibración externa";
}

export function normalizeMetrologyWorkspace(value: Partial<MetrologyWorkspaceState> | null | undefined, fallbackAssets: MeasurementAsset[]): MetrologyWorkspaceState {
  return {
    assets: Array.isArray(value?.assets) ? value.assets : fallbackAssets,
    reports: Array.isArray(value?.reports) ? value.reports : [],
  };
}

export function buildReportIdentity(asset: MeasurementAsset, session: ActiveSession, template: MetrologyReportTemplate, completedAt: string, nextDueDate: string) {
  const createdAt = new Date().toISOString();
  return {
    id: `MET-${asset.code}-${createdAt.replace(/\D/g, "").slice(0, 14)}`,
    assetId: asset.id,
    assetCode: asset.code,
    template,
    completedAt,
    nextDueDate,
    performedBy: session.name,
    performedByUserId: session.authUserId ?? session.userId,
    signedAt: createdAt,
    createdAt,
  };
}

export function latestReportForAsset(reports: MetrologyReport[], assetId: string) {
  return reports.filter((report) => report.assetId === assetId).sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.createdAt.localeCompare(a.createdAt))[0];
}
