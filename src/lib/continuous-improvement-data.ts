import type { ActiveSession } from "@/lib/session-data";

export type ImprovementProjectType = "kaizen" | "dmaic";
export type ImprovementProjectCategory = "kpi" | "process" | "sgc" | "culture";
export type ImprovementProjectStatus =
  | "Abierto"
  | "Kick off"
  | "En proceso"
  | "Tarde"
  | "Terminado";
export type ImprovementItemStatus = "pending" | "active" | "completed";
export type RapidImprovementKind = "Documental" | "Dispositivo" | "Herramental" | "Proceso" | "Área";

export interface ImprovementScoreCriterion {
  id: string;
  label: string;
  description: string;
  weight: number;
  rating: number;
  maxRating: number;
  options: readonly { value: number; label: string }[];
}

export interface ImprovementTool {
  id: string;
  name: string;
  description: string;
  status: ImprovementItemStatus;
}

export interface ImprovementPhase {
  id: string;
  name: string;
  targetDate: string;
  status: ImprovementItemStatus;
  tools: ImprovementTool[];
}

export interface ImprovementAction {
  id: string;
  description: string;
  owner: string;
  dueDate: string;
  status: "Pendiente" | "En curso" | "Completada";
  evidenceName?: string;
}

export interface ImprovementEvidence {
  id: string;
  name: string;
  uploadedBy: string;
  uploadedAt: string;
  phaseId?: string;
}

export interface RapidImprovementReport {
  kind: RapidImprovementKind;
  beforeDescription: string;
  improvementDescription: string;
  beforeEvidenceName?: string;
  improvementEvidenceName?: string;
  releasedBy: string;
  approvedBy: string;
  releasedAt?: string;
}

export interface ImprovementProject {
  id: string;
  code: string;
  title: string;
  type: ImprovementProjectType;
  category: ImprovementProjectCategory;
  intakeSource: "idea" | "direct";
  status: ImprovementProjectStatus;
  processId: string;
  submittedBy: string;
  sponsor: string;
  leader: string;
  improvementOwner: string;
  problem: string;
  objective: string;
  scope: string;
  customer: string;
  metric: string;
  baseline: string;
  target: string;
  startDate: string;
  targetDate: string;
  estimatedInvestment: number;
  estimatedSavings: number;
  realizedBenefit: number;
  team: string[];
  scorecard: ImprovementScoreCriterion[];
  phases: ImprovementPhase[];
  actions: ImprovementAction[];
  evidence: ImprovementEvidence[];
  rapidImprovement?: RapidImprovementReport;
  createdAt: string;
  updatedAt: string;
}

export interface CreateImprovementProjectInput {
  title: string;
  type: ImprovementProjectType;
  category: ImprovementProjectCategory;
  intakeSource?: "idea" | "direct";
  processId: string;
  submittedBy: string;
  sponsor: string;
  leader: string;
  problem: string;
  objective: string;
  scope: string;
  customer: string;
  metric: string;
  baseline: string;
  target: string;
  startDate: string;
  targetDate: string;
  estimatedInvestment: number;
  estimatedSavings: number;
  team: string[];
}

export const improvementProjectTypeLabels: Record<ImprovementProjectType, string> = {
  kaizen: "Kaizen",
  dmaic: "DMAIC",
};

export const improvementProjectTypeDescriptions: Record<ImprovementProjectType, string> = {
  kaizen: "Mejora directa o colaborativa con evidencia antes/después y estandarización.",
  dmaic: "Problema complejo que requiere medición, análisis estadístico y control.",
};

export const improvementProjectCategoryLabels: Record<ImprovementProjectCategory, string> = {
  kpi: "KPIs",
  process: "Proceso",
  sgc: "SGC",
  culture: "Cultura organizacional",
};

export const improvementScoreWeights = [
  { id: "impact", label: "Impacto del proyecto", description: "1 Bajo · 3 Medio · 7 Alto", weight: 30, maxRating: 7, options: [{ value: 1, label: "Bajo impacto" }, { value: 3, label: "Impacto medio" }, { value: 7, label: "Alto impacto" }] },
  { id: "implementationTime", label: "Tiempo de implementación", description: "1 Alto · 3 Medio · 7 Corto", weight: 10, maxRating: 7, options: [{ value: 1, label: "Alto" }, { value: 3, label: "Medio" }, { value: 7, label: "Corto" }] },
  { id: "development", label: "Nivel de desarrollo", description: "Metodología y ahorro esperado", weight: 20, maxRating: 8, options: [{ value: 2, label: "Kaizen sin ahorro o < $2 mil" }, { value: 4, label: "DMAIC con ahorro < $3 mil" }, { value: 6, label: "Kaizen con ahorro > $5 mil" }, { value: 8, label: "DMAIC con ahorro > $10 mil" }] },
  { id: "implementation", label: "Implementación", description: "1 Sin implementar · 3 Parcial · 7 Implementado", weight: 20, maxRating: 7, options: [{ value: 1, label: "Sin implementar" }, { value: 3, label: "Parcialmente implementado" }, { value: 7, label: "Implementado" }] },
  { id: "documentation", label: "Documentación realizada y permeada", description: "1 Sin documentar · 3 Parcial · 7 Documentado", weight: 10, maxRating: 7, options: [{ value: 1, label: "Sin documentar" }, { value: 3, label: "Parcialmente documentado" }, { value: 7, label: "Documentado" }] },
  { id: "training", label: "Capacitación al personal", description: "1 Sin capacitación · 3 Parcial · 7 Capacitado", weight: 10, maxRating: 7, options: [{ value: 1, label: "Sin capacitación" }, { value: 3, label: "Parcialmente capacitado" }, { value: 7, label: "Capacitado" }] },
] as const;

export const maximumRpmScore = 7.2;

const routeTemplates: Record<
  ImprovementProjectType,
  Array<{ id: string; name: string; tools: Array<{ name: string; description: string }> }>
> = {
  kaizen: [
    {
      id: "prepare",
      name: "Preparar",
      tools: [
        { name: "Carátula y línea de tiempo", description: "Problema, objetivo, alcance, equipo e hitos." },
        { name: "Métrica y condición actual", description: "Línea base y descripción del proceso." },
        { name: "Meta Kaizen", description: "Condición ideal cuantificada y fecha objetivo." },
      ],
    },
    {
      id: "analyze",
      name: "Analizar",
      tools: [
        { name: "Análisis del problema", description: "Desperdicio, variación y causas observadas." },
        { name: "Causa raíz", description: "Pareto, Ishikawa o 5 porqués según corresponda." },
      ],
    },
    {
      id: "implement",
      name: "Implementar",
      tools: [
        { name: "Plan de acción", description: "Acciones, responsables, fechas y evidencias." },
        { name: "Resultados antes y después", description: "Comparación de la métrica y beneficio." },
      ],
    },
    {
      id: "sustain",
      name: "Sostener",
      tools: [
        { name: "Prevención y estándar", description: "Controles para evitar la recurrencia." },
        { name: "Planes futuros", description: "Replicación y oportunidades siguientes." },
      ],
    },
  ],
  dmaic: [
    {
      id: "define",
      name: "Definir",
      tools: [
        { name: "Project charter", description: "Carátula, problema, objetivo SMART, alcance, equipo e hitos." },
        { name: "5W2H", description: "Qué, quién, por qué, dónde, cuándo, cuánto y cómo." },
        { name: "Economía del proyecto", description: "Inversión, ahorro y beneficio estimado." },
      ],
    },
    {
      id: "measure",
      name: "Medir",
      tools: [
        { name: "Diagrama del proceso actual", description: "Operación, movimiento, almacén, inspección y retrabajo." },
        { name: "Variables e indicadores", description: "Características críticas y validación del sistema de medición." },
        { name: "Capacidad inicial", description: "Comportamiento actual del proceso contra objetivo y especificación." },
      ],
    },
    {
      id: "analyze",
      name: "Analizar",
      tools: [
        { name: "Pareto", description: "Estratificación de primer y segundo nivel." },
        { name: "Ishikawa y 5 porqués", description: "Identificación estructurada de causas raíz." },
        { name: "Matriz de priorización", description: "Severidad, ocurrencia y detección para enfocar las causas." },
      ],
    },
    {
      id: "improve",
      name: "Implementar",
      tools: [
        { name: "Matriz esfuerzo-beneficio", description: "Selección de soluciones factibles y efectivas." },
        { name: "Plan general y Gantt", description: "Acciones, responsables, fechas, seguimiento y evidencias." },
      ],
    },
    {
      id: "control",
      name: "Controlar",
      tools: [
        { name: "Capacidad antes y después", description: "Tendencia y confirmación estadística del resultado." },
        { name: "Estandarización", description: "Documentos, capacitación, listas de verificación y auditorías." },
        { name: "Cierre y réplica", description: "Beneficio real, autorización y extensión a otros procesos." },
      ],
    },
  ],
};

export function buildProjectScorecard(
  ratings: Partial<Record<string, number>> = {},
): ImprovementScoreCriterion[] {
  return improvementScoreWeights.map((criterion) => ({
    ...criterion,
    rating: snapRating(
      ratings[criterion.id] ?? criterion.options[0].value,
      criterion.options.map((option) => option.value),
    ),
  }));
}

export function calculateProjectRpmScore(scorecard: ImprovementScoreCriterion[]) {
  return Number(
    scorecard
      .reduce((total, criterion) => total + criterion.rating * (criterion.weight / 100), 0)
      .toFixed(2),
  );
}

export function calculateProjectScore(scorecard: ImprovementScoreCriterion[]) {
  return Math.round((calculateProjectRpmScore(scorecard) / maximumRpmScore) * 100);
}

export function calculateProjectCompliance(scorecard: ImprovementScoreCriterion[]) {
  const rating = (id: string) => scorecard.find((criterion) => criterion.id === id)?.rating ?? 1;
  return Math.round(
    ((rating("implementation") * 0.6 +
      rating("documentation") * 0.2 +
      rating("training") * 0.2) /
      7) *
      100,
  );
}

export function getProjectProgress(project: ImprovementProject) {
  const tools = project.phases.flatMap((phase) => phase.tools);
  if (!tools.length) return 0;
  const completed = tools.filter((tool) => tool.status === "completed").length;
  const active = tools.filter((tool) => tool.status === "active").length;
  return Math.round(((completed + active * 0.5) / tools.length) * 100);
}

export function getImprovementProjectsForSession(
  projects: ImprovementProject[],
  session: ActiveSession,
) {
  if (
    session.userType === "Administrador" ||
    session.continuousImprovementRole === "manager"
  ) {
    return projects;
  }
  return projects.filter(
    (project) =>
      project.submittedBy === session.name ||
      project.leader === session.name ||
      session.assignedProcessIds.includes(project.processId),
  );
}

export function buildProjectRoute(
  type: ImprovementProjectType,
  startDate: string,
  targetDate: string,
  activePhaseIndex = 0,
): ImprovementPhase[] {
  const templates = routeTemplates[type];
  return templates.map((phase, phaseIndex) => {
    const status: ImprovementItemStatus =
      phaseIndex < activePhaseIndex
        ? "completed"
        : phaseIndex === activePhaseIndex
          ? "active"
          : "pending";
    return {
      id: phase.id,
      name: phase.name,
      targetDate: interpolateDate(startDate, targetDate, (phaseIndex + 1) / templates.length),
      status,
      tools: phase.tools.map((tool, toolIndex) => ({
        id: `${phase.id}-${toolIndex + 1}`,
        ...tool,
        status:
          status === "completed"
            ? "completed"
            : status === "active" && toolIndex === 0
              ? "active"
              : "pending",
      })),
    };
  });
}

export function createImprovementProject(
  input: CreateImprovementProjectInput,
  sequence: number,
): ImprovementProject {
  const now = new Date().toISOString();
  const year = new Date(input.startDate || now).getFullYear();
  return {
    id: `MC-${Date.now()}`,
    code: `MC-${year}-${String(sequence).padStart(3, "0")}`,
    ...input,
    intakeSource: input.intakeSource ?? "direct",
    status: "Abierto",
    improvementOwner: "Por asignar",
    realizedBenefit: 0,
    scorecard: buildProjectScorecard(),
    phases: buildProjectRoute(input.type, input.startDate, input.targetDate),
    actions: [],
    evidence: [],
    rapidImprovement: input.type === "kaizen"
      ? {
          kind: "Proceso",
          beforeDescription: input.problem,
          improvementDescription: "Por documentar",
          releasedBy: "Gerente de Mejora Continua",
          approvedBy: "Dirección de Planta",
        }
      : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildInitialImprovementProjects(): ImprovementProject[] {
  const dmaic = createImprovementProject(
    {
      title: "Reducción de reprocesos en Tintorería",
      type: "dmaic",
      category: "kpi",
      processId: "P-17",
      submittedBy: "Francisco Javier Hernández Retana",
      sponsor: "Dirección de Operaciones",
      leader: "Miguel Portillo",
      problem: "Los reprocesos en Tintorería provocan entregas fuera de tiempo y producto fuera de especificación para Costura y Acabado.",
      objective: "Disminuir el porcentaje de reprocesos en tres meses y entregar con los parámetros requeridos por el cliente interno.",
      scope: "Procesos de Tintorería y Secado en planta Towell.",
      customer: "Costura / Acabado",
      metric: "% de piezas reprocesadas y cumplimiento de color",
      baseline: "12.4% de reproceso",
      target: "≤ 6.0% de reproceso",
      startDate: "2026-07-01",
      targetDate: "2026-10-15",
      estimatedInvestment: 85000,
      estimatedSavings: 420000,
      team: ["Citali Ruiz", "Edmundo Saldaña", "Fernando Caballero", "Gabriela Perea"],
    },
    1,
  );
  dmaic.id = "MC-DMAIC-TINT-001";
  dmaic.code = "MC-2026-001";
  dmaic.status = "En proceso";
  dmaic.improvementOwner = "Encargado de Mejora Continua";
  dmaic.scorecard = buildProjectScorecard({ impact: 7, implementationTime: 3, development: 8, implementation: 3, documentation: 3, training: 1 });
  dmaic.phases = buildProjectRoute("dmaic", dmaic.startDate, dmaic.targetDate, 2);
  dmaic.actions = [
    { id: "ACT-MC-001", description: "Validar sistema de medición del colorímetro", owner: "Laboratorio", dueDate: "2026-08-21", status: "Completada", evidenceName: "MSA_colorimetro.pdf" },
    { id: "ACT-MC-002", description: "Estratificar reprocesos por tono, máquina y turno", owner: "Miguel Portillo", dueDate: "2026-08-28", status: "En curso" },
  ];
  dmaic.evidence = [
    { id: "EVI-MC-001", name: "MSA_colorimetro.pdf", uploadedBy: "Laboratorio", uploadedAt: "2026-08-20T17:00:00.000Z", phaseId: "measure" },
  ];

  const kaizen = createImprovementProject(
    {
      title: "Reducir tiempo de cambio de estilo en Tejido",
      type: "kaizen",
      category: "process",
      processId: "P-13",
      submittedBy: "Jefe de Tejido",
      sponsor: "Dirección de Operaciones",
      leader: "Jefe de Tejido",
      problem: "Los cambios de estilo generan esperas y ajustes repetidos antes de estabilizar el telar.",
      objective: "Reducir 30% el tiempo promedio de cambio y estabilización.",
      scope: "Línea de tejido piloto.",
      customer: "Planeación y Tintorería",
      metric: "Minutos por cambio de estilo",
      baseline: "95 minutos",
      target: "≤ 66 minutos",
      startDate: "2026-08-05",
      targetDate: "2026-09-30",
      estimatedInvestment: 25000,
      estimatedSavings: 180000,
      team: ["Jefe de Tejido", "Mantenimiento", "Planeación"],
    },
    2,
  );
  kaizen.id = "MC-KAIZEN-TEJ-002";
  kaizen.code = "MC-2026-002";
  kaizen.status = "Kick off";
  kaizen.improvementOwner = "Encargado de Mejora Continua";
  kaizen.scorecard = buildProjectScorecard({ impact: 3, implementationTime: 7, development: 6, implementation: 3, documentation: 1, training: 1 });
  kaizen.phases = buildProjectRoute("kaizen", kaizen.startDate, kaizen.targetDate, 1);

  const completedKaizen = createImprovementProject(
    {
      title: "Identificación visual de tarimas en PT",
      type: "kaizen",
      category: "process",
      processId: "P-34",
      submittedBy: "Logística y Distribución",
      sponsor: "Gerencia de Logística y Distribución",
      leader: "Logística y Distribución",
      problem: "La identificación manual ocasiona confusión entre tarimas liberadas y pendientes.",
      objective: "Eliminar movimientos erróneos mediante identificación visual estandarizada.",
      scope: "Almacén de producto terminado.",
      customer: "PT Embarques",
      metric: "Movimientos erróneos por semana",
      baseline: "4 movimientos",
      target: "0 movimientos",
      startDate: "2026-07-20",
      targetDate: "2026-08-15",
      estimatedInvestment: 4500,
      estimatedSavings: 36000,
      team: ["PT Preparación", "PT Embarques"],
    },
    3,
  );
  completedKaizen.id = "MC-KAIZEN-PT-003";
  completedKaizen.code = "MC-2026-003";
  completedKaizen.status = "Terminado";
  completedKaizen.improvementOwner = "Encargado de Mejora Continua";
  completedKaizen.realizedBenefit = 32000;
  completedKaizen.scorecard = buildProjectScorecard({ impact: 3, implementationTime: 7, development: 6, implementation: 7, documentation: 7, training: 7 });
  completedKaizen.phases = buildProjectRoute("kaizen", completedKaizen.startDate, completedKaizen.targetDate, 99);
  completedKaizen.phases = completedKaizen.phases.map((phase) => ({ ...phase, status: "completed", tools: phase.tools.map((tool) => ({ ...tool, status: "completed" })) }));
  completedKaizen.rapidImprovement = {
    kind: "Dispositivo",
    beforeDescription: completedKaizen.problem,
    improvementDescription: "Se implementó una identificación visual estandarizada para distinguir tarimas liberadas y pendientes.",
    beforeEvidenceName: "tarimas_antes.jpg",
    improvementEvidenceName: "tarimas_mejora.jpg",
    releasedBy: "Gerente de Mejora Continua",
    approvedBy: "Dirección de Planta",
    releasedAt: "2026-08-15",
  };

  return [dmaic, kaizen, completedKaizen];
}

export function normalizeImprovementProjects(projects: ImprovementProject[]) {
  return projects.map((project) => {
    const legacyType = project.type as ImprovementProjectType | "quick";
    const type: ImprovementProjectType = legacyType === "quick" ? "kaizen" : legacyType;
    const legacyStatus = project.status as ImprovementProjectStatus | "Propuesta" | "En evaluación" | "Activo" | "En espera" | "Cerrado";
    const statusMap: Record<string, ImprovementProjectStatus> = {
      Propuesta: "Abierto",
      "En evaluación": "Abierto",
      Activo: "En proceso",
      "En espera": "Tarde",
      Cerrado: "Terminado",
    };
    const hasFmc002Scorecard = project.scorecard?.some((criterion) => criterion.id === "impact");
    const currentRatings = hasFmc002Scorecard
      ? Object.fromEntries(project.scorecard.map((criterion) => [criterion.id, criterion.rating]))
      : {};
    const isUnratedLegacyProject = hasFmc002Scorecard && project.status !== "Abierto" && project.scorecard.every((criterion) => criterion.rating === criterion.options[0]?.value);
    const suggestedRatings = type === "dmaic"
      ? { impact: 7, implementationTime: 3, development: 8, implementation: 3, documentation: 3, training: 1 }
      : project.status === "Terminado" || legacyStatus === "Cerrado"
        ? { impact: 3, implementationTime: 7, development: 6, implementation: 7, documentation: 7, training: 7 }
        : { impact: 3, implementationTime: 7, development: 6, implementation: 3, documentation: 1, training: 1 };
    const seedRapidReport = project.code === "MC-2026-003" && (!project.rapidImprovement || project.rapidImprovement.improvementDescription === "Por documentar")
      ? {
          kind: "Dispositivo" as const,
          beforeDescription: project.problem,
          improvementDescription: "Se implementó una identificación visual estandarizada para distinguir tarimas liberadas y pendientes.",
          beforeEvidenceName: "tarimas_antes.jpg",
          improvementEvidenceName: "tarimas_mejora.jpg",
          releasedBy: "Gerente de Mejora Continua",
          approvedBy: "Dirección de Planta",
          releasedAt: "2026-08-15",
        }
      : undefined;
    const rapidImprovement = type === "kaizen"
      ? seedRapidReport ?? project.rapidImprovement ?? {
          kind: "Proceso" as const,
          beforeDescription: project.problem,
          improvementDescription: "Por documentar",
          releasedBy: "Gerente de Mejora Continua",
          approvedBy: "Dirección de Planta",
        }
      : undefined;

    return {
      ...project,
      type,
      category: project.code === "MC-2026-001" ? "kpi" : project.category ?? (project.processId === "P-08" ? "sgc" : "process"),
      intakeSource: project.intakeSource ?? "direct",
      status: type === "kaizen" && (legacyStatus === "Activo" || (legacyStatus === "En proceso" && isUnratedLegacyProject)) ? "Kick off" : statusMap[legacyStatus] ?? legacyStatus,
      scorecard: buildProjectScorecard(hasFmc002Scorecard && !isUnratedLegacyProject ? currentRatings : suggestedRatings),
      phases: legacyType === "quick"
        ? buildProjectRoute("kaizen", project.startDate, project.targetDate, legacyStatus === "Cerrado" || legacyStatus === "Terminado" ? 99 : Math.max(0, project.phases.findIndex((phase) => phase.status === "active")))
        : project.phases,
      rapidImprovement,
    };
  });
}

function snapRating(value: number, allowedValues: readonly number[]) {
  return allowedValues.reduce((closest, option) => (
    Math.abs(option - value) < Math.abs(closest - value) ? option : closest
  ), allowedValues[0]);
}

function interpolateDate(start: string, end: string, ratio: number) {
  const startTime = new Date(`${start}T12:00:00`).getTime();
  const endTime = new Date(`${end}T12:00:00`).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return end;
  const value = new Date(startTime + (endTime - startTime) * ratio);
  return value.toISOString().slice(0, 10);
}
