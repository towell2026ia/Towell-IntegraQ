import { NextResponse } from "next/server";

import type {
  ManagementReviewAiDraft,
  ManagementReviewAiRequest,
  ManagementReviewDecision,
  ManagementReviewSection,
  ManagementReviewSourceSnapshot,
} from "@/lib/management-review-data";

function isRequest(value: unknown): value is ManagementReviewAiRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ManagementReviewAiRequest>;
  const context = candidate.context;
  return Boolean(
    candidate.task === "management_review" &&
      context &&
      typeof context === "object" &&
      typeof context.capturedAt === "string" &&
      typeof context.fingerprint === "string" &&
      context.period &&
      typeof context.period.year === "number" &&
      Array.isArray(context.sources) &&
      context.sources.length > 0,
  );
}

function createDemoDraft(request: ManagementReviewAiRequest): ManagementReviewAiDraft {
  const { context } = request;
  const connected = context.sources.filter((source) => source.status === "connected");
  const pending = context.sources.filter((source) => source.status === "pending");
  const get = (id: ManagementReviewSourceSnapshot["id"]) =>
    context.sources.find((source) => source.id === id);
  const sourceText = (...ids: ManagementReviewSourceSnapshot["id"][]) =>
    ids.map((id) => get(id)?.summary).filter(Boolean).join(" ");

  const sections: ManagementReviewSection[] = [
    {
      id: "previous-actions",
      title: "1. Seguimiento a acuerdos de revisiones anteriores",
      content:
        "No existe una fuente estructurada de acuerdos de revisiones anteriores en IntegraQ. En esta primera emisión se debe registrar el punto de partida y convertir las decisiones de esta acta en compromisos trazables para el siguiente periodo.",
      sourceIds: [],
    },
    {
      id: "context-changes",
      title: "2. Cambios internos y externos relevantes",
      content:
        "La evidencia consolidada permite revisar cambios operativos reflejados en documentos, auditorías, resultados y acciones. El responsable del SGC debe complementar este apartado con cambios normativos, organizacionales, tecnológicos o comerciales que todavía no estén registrados en los módulos.",
      sourceIds: ["documents", "audits", "customers", "suppliers"],
    },
    {
      id: "performance",
      title: "3. Desempeño y eficacia del Sistema de Gestión",
      content: sourceText("documents", "objectives", "root2cause"),
      sourceIds: ["documents", "objectives", "root2cause"],
    },
    {
      id: "stakeholders",
      title: "4. Clientes y proveedores",
      content: sourceText("customers", "suppliers"),
      sourceIds: ["customers", "suppliers"],
    },
    {
      id: "audits",
      title: "5. Resultados de auditorías",
      content: sourceText("audits"),
      sourceIds: ["audits"],
    },
    {
      id: "monitoring",
      title: "6. Seguimiento, medición y recursos de control",
      content: sourceText("objectives", "calibrations"),
      sourceIds: ["objectives", "calibrations"],
    },
    {
      id: "risks",
      title: "7. Riesgos, oportunidades y adecuación de recursos",
      content:
        "El módulo de Riesgos y oportunidades aún no aporta registros consolidados. La Dirección debe evaluar manualmente los riesgos prioritarios, la suficiencia de personal, infraestructura, competencia y presupuesto, y dejar las decisiones correspondientes en esta revisión.",
      sourceIds: ["risks"],
    },
    {
      id: "improvement",
      title: "8. Oportunidades de mejora y decisiones",
      content:
        "Las oportunidades se derivan de documentos por atender, indicadores sin captura o fuera de meta, acciones vencidas, hallazgos, RNCP y equipos fuera de vigencia. El futuro módulo de Mejora continua deberá recibir y dar seguimiento a las decisiones autorizadas en esta sección.",
      sourceIds: ["continuous-improvement", "root2cause", "objectives", "calibrations"],
    },
  ];

  const decisions = buildDecisions(context.sources, context.capturedAt);
  const issueCount = decisions.filter((decision) => decision.priority === "Alta").length;

  return {
    mode: "demo",
    executiveSummary: `IntegraQ consolidó ${connected.length} de ${context.sources.length} fuentes para la ${context.period.label.toLocaleLowerCase("es")}. La revisión identifica ${decisions.length} decisiones propuestas, ${issueCount} de prioridad alta, y mantiene ${pending.length} fuentes expresamente pendientes de integración. Este contenido es un borrador asistido y requiere validación del responsable del SGC antes de presentarse a Dirección de Operaciones.`,
    sections,
    keyFindings: buildFindings(context.sources),
    decisions,
    warnings: [
      "El contenido fue generado a partir de una fotografía de datos y no se actualizará automáticamente después de su emisión.",
      "La IA propone redacción y prioridades; las conclusiones y decisiones pertenecen a los autorizadores.",
      ...pending.map((source) => `${source.label}: ${source.summary}`),
    ],
  };
}

function buildFindings(sources: ManagementReviewSourceSnapshot[]) {
  return sources
    .filter((source) => source.status === "connected")
    .map((source) => `${source.label}: ${source.summary}`)
    .slice(0, 7);
}

function buildDecisions(
  sources: ManagementReviewSourceSnapshot[],
  capturedAt: string,
): ManagementReviewDecision[] {
  const decisions: ManagementReviewDecision[] = [];
  const due30 = addDays(capturedAt, 30);
  const due60 = addDays(capturedAt, 60);
  const metric = (sourceId: string, label: string) => {
    const value = sources
      .find((source) => source.id === sourceId)
      ?.metrics.find((item) => item.label === label)?.value;
    return Number.parseFloat(value ?? "0") || 0;
  };

  if (metric("root2cause", "Vencidas") > 0) {
    decisions.push({
      id: "DEC-CAPA-01",
      description: "Regularizar las acciones correctivas vencidas y validar su eficacia con evidencia.",
      owner: "Gerencia de Calidad",
      dueDate: due30,
      priority: "Alta",
    });
  }
  if (metric("objectives", "Sin captura") > 0 || metric("objectives", "No cumplen") > 0) {
    decisions.push({
      id: "DEC-OBJ-01",
      description: "Completar los resultados faltantes y acordar planes para indicadores fuera de meta.",
      owner: "Responsables de proceso",
      dueDate: due30,
      priority: "Alta",
    });
  }
  if (metric("documents", "Por atender") > 0) {
    decisions.push({
      id: "DEC-DOC-01",
      description: "Cerrar validaciones y correcciones pendientes de información documentada.",
      owner: "Responsable del SGC",
      dueDate: due30,
      priority: "Media",
    });
  }
  if (metric("calibrations", "Vencidos") > 0) {
    decisions.push({
      id: "DEC-CAL-01",
      description: "Restablecer la vigencia de los equipos de medición vencidos antes de su uso.",
      owner: "Metrología y proceso usuario",
      dueDate: due30,
      priority: "Alta",
    });
  }
  if (sources.some((source) => source.status === "pending")) {
    decisions.push({
      id: "DEC-SGC-01",
      description: "Integrar las fuentes pendientes de Riesgos y Mejora continua para la siguiente revisión.",
      owner: "Responsable del SGC",
      dueDate: due60,
      priority: "Media",
    });
  }
  return decisions;
}

function addDays(value: string, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeExternalDraft(value: unknown): ManagementReviewAiDraft {
  const candidate = value as Partial<ManagementReviewAiDraft>;
  const strings = (input: unknown) =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
  const sections = Array.isArray(candidate.sections)
    ? candidate.sections.filter(isSection)
    : [];
  const decisions = Array.isArray(candidate.decisions)
    ? candidate.decisions.filter(isDecision)
    : [];

  return {
    mode: "external",
    executiveSummary:
      typeof candidate.executiveSummary === "string"
        ? candidate.executiveSummary
        : "Borrador recibido del servicio de IA.",
    sections,
    keyFindings: strings(candidate.keyFindings),
    decisions,
    warnings: strings(candidate.warnings),
  };
}

function isSection(value: unknown): value is ManagementReviewSection {
  if (!value || typeof value !== "object") return false;
  const section = value as Partial<ManagementReviewSection>;
  return Boolean(
    typeof section.id === "string" &&
      typeof section.title === "string" &&
      typeof section.content === "string" &&
      Array.isArray(section.sourceIds),
  );
}

function isDecision(value: unknown): value is ManagementReviewDecision {
  if (!value || typeof value !== "object") return false;
  const decision = value as Partial<ManagementReviewDecision>;
  return Boolean(
    typeof decision.id === "string" &&
      typeof decision.description === "string" &&
      typeof decision.owner === "string" &&
      typeof decision.dueDate === "string" &&
      ["Alta", "Media", "Baja"].includes(decision.priority ?? ""),
  );
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!isRequest(body)) {
    return NextResponse.json(
      { error: "Se requiere un contexto consolidado válido para generar la revisión." },
      { status: 400 },
    );
  }

  const endpoint =
    process.env.INTEGRAQ_MANAGEMENT_REVIEW_AI_ENDPOINT ?? process.env.INTEGRAQ_AI_ENDPOINT;
  const apiKey = process.env.INTEGRAQ_AI_API_KEY;
  if (!endpoint) return NextResponse.json(createDemoDraft(body));

  try {
    const externalResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!externalResponse.ok) {
      throw new Error(`El servicio de IA respondió ${externalResponse.status}.`);
    }
    return NextResponse.json(normalizeExternalDraft(await externalResponse.json()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible consultar la IA.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

