import type { ConfiguredIndicator } from "@/lib/indicator-data";
import directionSource from "@/lib/risk-direction-source-2025.json";

export const riskTabs = [
  "summary",
  "direction",
  "okr",
  "swot",
  "matrix",
  "actions",
  "contributions",
  "settings",
] as const;

export type RiskTab = (typeof riskTabs)[number];
export type RiskKind = "risk" | "opportunity";
export type RiskLevel = "MENOR" | "MAYOR" | "CRÍTICO";
export type SwotQuadrant = "strength" | "opportunity" | "weakness" | "threat";
export type ContributionStatus = "pending" | "clarification" | "incorporated" | "linked" | "dismissed";

export const riskTreatmentCatalog = [
  "EVITAR EL RIESGO.",
  "ASUMIR EL RIESGO PARA PERSEGUIR UNA OPORTUNIDAD.",
  "ELIMINAR LA FUENTE DE RIESGO.",
  "CAMBIAR LA PROBABILIDAD O CONSECUENCIA.",
  "COMPARTIR EL RIESGO.",
  "MANTENER EL RIESGO MEDIANTE DECISIONES INFORMADAS.",
  "TRANSFERIR EL RIESGO",
] as const;

export type RiskTreatment = (typeof riskTreatmentCatalog)[number];

export interface RiskAssessment {
  severity?: number;
  occurrence?: number;
  detection?: number;
  so?: number;
  sod?: number;
  level?: RiskLevel;
  version: string;
  evaluatedAt: string;
}

export interface RiskRecord {
  id: string;
  kind: RiskKind;
  processId: string;
  cycle: number;
  title: string;
  event: string;
  consequence: string;
  owner: string;
  strategicAxisId: string;
  objectiveId?: string;
  status: "draft" | "review" | "approved" | "effectiveness_pending" | "closed";
  treatment: RiskTreatment;
  currentControls: string;
  initial: RiskAssessment;
  latest?: RiskAssessment;
  source: string;
}

export interface RiskAction {
  id: string;
  riskId: string;
  title: string;
  owner: string;
  dueDate: string;
  status: "open" | "in_progress" | "completed";
  evidence?: string;
  effectiveness: "pending" | "effective" | "not_effective";
}

export interface SwotItem {
  id: string;
  processId: string;
  cycle: number;
  quadrant: SwotQuadrant;
  description: string;
  status: "draft" | "published" | "review";
  author: string;
  strategicAxisId?: string;
  sourceContributionId?: string;
}

export interface CrossContribution {
  id: string;
  sourceProcessId: string;
  targetProcessId: string;
  quadrant: SwotQuadrant;
  comment: string;
  impact: string;
  author: string;
  createdAt: string;
  status: ContributionStatus;
  resolution?: string;
  linkedSwotItemId?: string;
}

export interface StrategicAxis {
  id: string;
  title: string;
  originalTarget: string;
  status: "review" | "ready";
  sourceCell: string;
}

export interface ImportIssue {
  id: string;
  location: string;
  value: string;
  issue: string;
  status: "pending" | "resolved";
}

export type DirectionCandidateKind = "pending" | "objective" | "key_result" | "risk" | "opportunity" | "initiative" | "control" | "activity";

export interface DirectionCandidate {
  id: string;
  sourceRow: number;
  description: string;
  responsibleLabel: string;
  controlPoint: string;
  roPrimary: string;
  roSecondary: string;
  historicalProgress: number | null;
  axisWeights: Array<number | string | null>;
  classification: DirectionCandidateKind;
  processId?: string;
  ownerName?: string;
  reviewStatus: "pending" | "ready";
}

export interface RiskWorkspaceState {
  cycle: number;
  cycleStatus: "preparation" | "active" | "closed";
  axes: StrategicAxis[];
  swotItems: SwotItem[];
  risks: RiskRecord[];
  actions: RiskAction[];
  contributions: CrossContribution[];
  importIssues: ImportIssue[];
  directionCandidates: DirectionCandidate[];
}

const axisSource: Array<[string, string]> = [
  ["Sistema de gestión integral ISO 9001 / ISO 14001", "100%"],
  ["Calidad", ">1.5%"],
  ["Limpieza del Atoyac / SOAPAP", "- Reducir"],
  ["Pruebas de laboratorio de Walmart en piso de venta", "100%"],
  ["Eficiencia, productividad y OEE", "100%"],
  ["Innovación de productos y mercados", "100%"],
  ["Exportación y hotelería", "20%"],
  ["Inventarios, lead time y dinero comprometido", "380Ton"],
  ["Reducción de costos", "- $5.00"],
  ["Mitigar riesgos bancarios, fiscales y de dependencias", "0"],
  ["Utilidades", "$ 10%"],
  ["Flujo", "+"],
];

export function buildInitialRiskWorkspace(): RiskWorkspaceState {
  return {
    cycle: new Date().getFullYear(),
    cycleStatus: "preparation",
    axes: axisSource.map(([title, originalTarget], index) => ({
      id: `EJE-${String(index + 1).padStart(2, "0")}`,
      title,
      originalTarget,
      status: [">1.5%", "100%", "20%", "- $5.00", "+"].includes(originalTarget) ? "review" : "ready",
      sourceCell: `${String.fromCharCode(66 + index)}12:${String.fromCharCode(66 + index)}13`,
    })),
    swotItems: [
      { id: "FODA-P10-001", processId: "P-10", cycle: 2025, quadrant: "threat", description: "Dependencia de un proveedor de hilo Cloud.", status: "review", author: "Importación 2025", strategicAxisId: "EJE-10" },
      { id: "FODA-P08-001", processId: "P-08", cycle: 2025, quadrant: "strength", description: "Sistema de gestión documentado y con seguimiento periódico.", status: "published", author: "Calidad", strategicAxisId: "EJE-01" },
      { id: "FODA-P07-001", processId: "P-07", cycle: 2025, quadrant: "weakness", description: "Dependencia de servicios tecnológicos externos para procesos críticos.", status: "draft", author: "Tecnologías de Información", strategicAxisId: "EJE-10" },
      { id: "FODA-P01-001", processId: "P-01", cycle: 2025, quadrant: "opportunity", description: "Crecimiento del canal de exportación y hotelería.", status: "review", author: "Ventas", strategicAxisId: "EJE-07" },
    ],
    risks: [
      {
        id: "RYO-2025-001", kind: "risk", processId: "P-10", cycle: 2025,
        title: "Dependencia de proveedor de hilo Cloud", event: "Desabasto o recepción de material alternativo fuera de especificación.", consequence: "Afectación a entregas y calidad del producto.", owner: "Responsable de Compras", strategicAxisId: "EJE-10", status: "effectiveness_pending", treatment: "CAMBIAR LA PROBABILIDAD O CONSECUENCIA.", currentControls: "Evaluación de proveedor y validación de muestras.",
        initial: calculateAssessment(7, 8, undefined, "SO-2025-v1", "2025-01-10"),
        latest: calculateAssessment(6, 4, undefined, "SO-2025-v1", "2025-05-01"),
        source: "Matriz 2025 ISO!R38",
      },
      {
        id: "RYO-2025-002", kind: "risk", processId: "P-07", cycle: 2025,
        title: "Interrupción de sistemas críticos", event: "Indisponibilidad prolongada de servicios de información.", consequence: "Paro de operación y pérdida temporal de trazabilidad.", owner: "Responsable de TI", strategicAxisId: "EJE-10", status: "review", treatment: "COMPARTIR EL RIESGO.", currentControls: "Respaldos y monitoreo de disponibilidad.",
        initial: calculateAssessment(8, 5, 6, "SOD-propuesta-v1", "2025-01-12"), source: "Captura manual de demostración",
      },
      {
        id: "RYO-2025-003", kind: "opportunity", processId: "P-01", cycle: 2025,
        title: "Desarrollo del segmento hotelero", event: "Riesgo de no aprovechar el crecimiento del segmento.", consequence: "Pérdida de participación potencial.", owner: "Responsable de Ventas", strategicAxisId: "EJE-07", status: "draft", treatment: "ASUMIR EL RIESGO PARA PERSEGUIR UNA OPORTUNIDAD.", currentControls: "Revisión mensual de cartera y capacidad.",
        initial: calculateAssessment(5, 4, 5, "SOD-propuesta-v1", "2025-01-15"), source: "Matriz 2025 ISO!H12:H13",
      },
    ],
    actions: [
      { id: "ACT-RYO-001", riskId: "RYO-2025-001", title: "Evaluar dos proveedores alternativos", owner: "Responsable de Compras", dueDate: "2025-03-31", status: "completed", evidence: "Evaluación técnica de muestras.pdf", effectiveness: "pending" },
      { id: "ACT-RYO-002", riskId: "RYO-2025-002", title: "Probar recuperación integral de respaldos", owner: "Responsable de TI", dueDate: "2025-04-15", status: "in_progress", effectiveness: "pending" },
      { id: "ACT-RYO-003", riskId: "RYO-2025-003", title: "Definir universo y meta del KR hotelero", owner: "Responsable de Ventas", dueDate: "2025-02-28", status: "open", effectiveness: "pending" },
    ],
    contributions: [
      { id: "APO-2025-001", sourceProcessId: "P-08", targetProcessId: "P-10", quadrant: "weakness", comment: "Verificar el desempeño del hilo alternativo antes de autorizar su uso.", impact: "Puede prevenir desviaciones de calidad y reclamos.", author: "Calidad", createdAt: "2025-01-18T10:30:00.000Z", status: "pending" },
      { id: "APO-2025-002", sourceProcessId: "P-07", targetProcessId: "P-04", quadrant: "strength", comment: "El tablero central puede concentrar evidencias de seguimiento.", impact: "Reduce consolidación manual.", author: "Tecnologías de Información", createdAt: "2025-01-16T15:20:00.000Z", status: "clarification", resolution: "Precisar qué controles y fuentes alimentarán el tablero." },
    ],
    importIssues: [
      { id: "IMP-001", location: "Matriz 2025 ISO!C13", value: ">1.5%", issue: "Falta definir indicador y confirmar el sentido de mejora.", status: "pending" },
      { id: "IMP-002", location: "Matriz 2025 ISO!F13", value: "100%", issue: "La celda agrupa eficiencia, productividad y OEE; requiere separar métricas.", status: "pending" },
      { id: "IMP-003", location: "Matriz 2025 ISO!P:Q", value: "R/O", issue: "La segunda columna de marcas no tiene encabezado inequívoco.", status: "pending" },
      { id: "IMP-004", location: "Matriz de riesgos!M10", value: "31-06-25", issue: "Fecha inválida; se conserva para corrección sin inventar un valor.", status: "pending" },
      { id: "IMP-005", location: "Matriz 2025 ISO!M13", value: "+", issue: "Meta no cuantificada; requiere definición de unidad, base y periodo.", status: "pending" },
    ],
    directionCandidates: directionSource.rows.map((row) => ({
      id: `DIR-2025-${String(row.sourceRow).padStart(3, "0")}`,
      sourceRow: row.sourceRow,
      description: row.description,
      responsibleLabel: row.responsibleLabel,
      controlPoint: row.controlPoint,
      roPrimary: row.roPrimary,
      roSecondary: row.roSecondary,
      historicalProgress: row.historicalProgress,
      axisWeights: row.weights,
      classification: "pending",
      reviewStatus: "pending",
    })),
  };
}

export function normalizeRiskWorkspace(value: Partial<RiskWorkspaceState> | null | undefined): RiskWorkspaceState {
  const baseline = buildInitialRiskWorkspace();
  if (!value) return baseline;
  return {
    ...baseline,
    ...value,
    axes: Array.isArray(value.axes) ? value.axes : baseline.axes,
    swotItems: Array.isArray(value.swotItems) ? value.swotItems : baseline.swotItems,
    risks: Array.isArray(value.risks) ? value.risks : baseline.risks,
    actions: Array.isArray(value.actions) ? value.actions : baseline.actions,
    contributions: Array.isArray(value.contributions) ? value.contributions : baseline.contributions,
    importIssues: Array.isArray(value.importIssues) ? value.importIssues : baseline.importIssues,
    directionCandidates: Array.isArray(value.directionCandidates) && value.directionCandidates.length ? value.directionCandidates : baseline.directionCandidates,
  };
}

export function validateRiskRating(value: number | undefined, field: "S" | "O" | "D") {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new RangeError(`${field} debe ser un número entero de 1 a 10.`);
  }
}

export function classifySO(score: number): RiskLevel {
  if (!Number.isInteger(score) || score < 1 || score > 100) throw new RangeError("SO debe estar entre 1 y 100.");
  if (score <= 25) return "MENOR";
  if (score <= 50) return "MAYOR";
  return "CRÍTICO";
}

export function calculateAssessment(severity?: number, occurrence?: number, detection?: number, version = "SO-v1", evaluatedAt = new Date().toISOString()): RiskAssessment {
  validateRiskRating(severity, "S");
  validateRiskRating(occurrence, "O");
  validateRiskRating(detection, "D");
  const so = severity !== undefined && occurrence !== undefined ? severity * occurrence : undefined;
  return {
    severity, occurrence, detection, so, sod: so !== undefined && detection !== undefined ? so * detection : undefined,
    level: so !== undefined ? classifySO(so) : undefined, version, evaluatedAt,
  };
}

export function calculateKeyResultProgress(base: number, target: number, actual: number | undefined, direction: "increase" | "decrease" | "maintain") {
  if (actual === undefined) return { progress: undefined, actualProgress: undefined, message: "Sin actualización" };
  if (direction === "maintain") return { progress: actual >= target ? 100 : 0, actualProgress: actual >= target ? 100 : 0 };
  if (base === target) throw new RangeError("La base y la meta no pueden ser iguales para aumentar o reducir.");
  if (direction === "increase" && target < base) throw new RangeError("La meta debe ser mayor que la base.");
  if (direction === "decrease" && target > base) throw new RangeError("La meta debe ser menor que la base.");
  const actualProgress = direction === "increase" ? ((actual - base) / (target - base)) * 100 : ((base - actual) / (base - target)) * 100;
  return { progress: Math.min(100, Math.max(0, actualProgress)), actualProgress };
}

export function incorporateContribution(state: RiskWorkspaceState, contributionId: string, editor: string): RiskWorkspaceState {
  const contribution = state.contributions.find((item) => item.id === contributionId);
  if (!contribution || contribution.linkedSwotItemId) return state;
  const swotItemId = `FODA-${contribution.targetProcessId}-${contribution.id}`;
  return {
    ...state,
    contributions: state.contributions.map((item) => item.id === contributionId ? { ...item, status: "incorporated", linkedSwotItemId: swotItemId, resolution: "Incorporada al FODA del proceso destino." } : item),
    swotItems: [...state.swotItems, { id: swotItemId, processId: contribution.targetProcessId, cycle: state.cycle, quadrant: contribution.quadrant, description: contribution.comment, status: "draft", author: editor, sourceContributionId: contribution.id }],
  };
}

export function getOkrCoverage(indicators: ConfiguredIndicator[], processIds: string[]) {
  const unique = new Set(indicators.filter((indicator) => processIds.includes(indicator.processId)).map((indicator) => indicator.id));
  return unique.size;
}
