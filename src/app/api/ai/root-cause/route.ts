import { NextResponse } from "next/server";

import type {
  AiRootCauseDraft,
  AiRootCauseRequest,
  CorrectiveActionSource,
} from "@/lib/types";

const validSources: CorrectiveActionSource[] = [
  "internal",
  "audit",
  "customer",
  "supplier",
];

function isRequest(value: unknown): value is AiRootCauseRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AiRootCauseRequest>;
  return (
    typeof candidate.problem === "string" &&
    candidate.problem.trim().length >= 15 &&
    typeof candidate.context === "string" &&
    typeof candidate.source === "string" &&
    validSources.includes(candidate.source as CorrectiveActionSource)
  );
}

function createDemoDraft(request: AiRootCauseRequest): AiRootCauseDraft {
  const sourceLabel = {
    internal: "una detección interna",
    audit: "un hallazgo de auditoría",
    customer: "un reclamo de cliente",
    supplier: "un incumplimiento de proveedor",
  }[request.source];
  const processLabel = request.contextSources?.processName
    ? ` del proceso ${request.contextSources.processName}`
    : "";
  const documentCount = request.contextSources?.documents.length ?? 0;
  const sectionCount = request.contextSources?.a3Sections.length ?? 0;

  return {
    mode: "demo",
    summary: `Borrador inicial para analizar ${sourceLabel}${processLabel}. Se consideraron la descripción integral, ${sectionCount} secciones del A3 y ${documentCount} documentos indexados.`,
    fiveWhys: [
      "¿Qué condición específica permitió que ocurriera el problema?",
      "¿Por qué el control existente no detectó esa condición a tiempo?",
      "¿Qué cambio de método, material, máquina, medición o personal precedió al evento?",
      "¿Por qué el estándar de trabajo no evitó o contuvo la desviación?",
      "¿Qué causa sistémica explica la recurrencia o la falta de detección?",
    ],
    probableRootCause:
      "La información disponible todavía no demuestra una causa raíz. La hipótesis inicial apunta a una brecha entre el control definido y su ejecución o verificación.",
    suggestedActions: [
      "Confirmar la secuencia real del proceso con evidencia objetiva.",
      "Comparar el evento con casos anteriores y condiciones normales.",
      "Definir una acción que elimine la causa y otra que fortalezca la detección.",
      "Establecer método, responsable y fecha para validar la eficacia.",
    ],
    warnings: [
      "No cerrar el análisis únicamente con este borrador.",
      "Adjuntar mediciones, fotografías, registros y entrevistas relevantes.",
      ...(documentCount === 0
        ? ["No existen documentos indexados para este proceso; las sugerencias no se contrastaron contra procedimientos o instructivos."]
        : []),
    ],
    contextSources: request.contextSources,
  };
}

function normalizeExternalDraft(
  value: unknown,
  request: AiRootCauseRequest,
): AiRootCauseDraft {
  const candidate = value as Partial<AiRootCauseDraft>;
  const toStringArray = (input: unknown): string[] =>
    Array.isArray(input)
      ? input.filter((item): item is string => typeof item === "string")
      : [];

  return {
    mode: "external",
    summary:
      typeof candidate.summary === "string"
        ? candidate.summary
        : "Análisis recibido de la aplicación externa.",
    fiveWhys: toStringArray(candidate.fiveWhys),
    probableRootCause:
      typeof candidate.probableRootCause === "string"
        ? candidate.probableRootCause
        : "Sin hipótesis normalizada.",
    suggestedActions: toStringArray(candidate.suggestedActions),
    warnings: toStringArray(candidate.warnings),
    contextSources: request.contextSources,
  };
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);

  if (!isRequest(body)) {
    return NextResponse.json(
      {
        error:
          "Se requiere problema, contexto y fuente válidos para iniciar el análisis.",
      },
      { status: 400 },
    );
  }

  const endpoint = process.env.INTEGRAQ_AI_ENDPOINT;
  const apiKey = process.env.INTEGRAQ_AI_API_KEY;

  if (!endpoint) {
    return NextResponse.json(createDemoDraft(body));
  }

  try {
    const externalResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    if (!externalResponse.ok) {
      throw new Error(`La aplicación externa respondió ${externalResponse.status}.`);
    }

    const payload: unknown = await externalResponse.json();
    return NextResponse.json(normalizeExternalDraft(payload, body));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No fue posible consultar la IA.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
