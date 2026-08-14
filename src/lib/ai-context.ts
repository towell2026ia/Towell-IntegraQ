import { processCatalog } from "@/lib/configuration-data";
import { documentTypeCatalog } from "@/lib/document-data";
import type {
  A3Analysis,
  AiDocumentReference,
  AiRootCauseRequest,
  CorrectiveActionSeverity,
  CorrectiveActionSource,
} from "@/lib/types";

interface BuildAiContextInput {
  title: string;
  problem: string;
  source: CorrectiveActionSource;
  severity: CorrectiveActionSeverity;
  area: string;
  owner: string;
  relatedParty?: string;
  analysis?: A3Analysis;
  documents?: AiDocumentReference[];
}

export function buildRootCauseAiRequest(
  input: BuildAiContextInput,
): AiRootCauseRequest {
  const process = findProcess(input.area);
  const parentProcess = process?.parentId
    ? processCatalog.find((item) => item.id === process.parentId)
    : undefined;
  const documents = input.documents ?? [];
  const a3Sections = getCompletedA3Sections(input.analysis);
  const documentFamilies = documentTypeCatalog.map(
    (documentType) => `${documentType.code} - ${documentType.name}`,
  );

  const contextLines = [
    `Título: ${input.title || "Sin título"}`,
    `Descripción integral: ${input.problem}`,
    `Origen: ${input.source}`,
    `Severidad: ${input.severity}`,
    `Área declarada: ${input.area || "Sin área"}`,
    `Proceso identificado: ${process ? `${process.id} - ${process.name}` : "Sin coincidencia en el MetroMap"}`,
    parentProcess ? `Proceso padre: ${parentProcess.id} - ${parentProcess.name}` : "",
    `Responsable: ${input.owner || "Sin responsable"}`,
    input.relatedParty ? `Parte relacionada: ${input.relatedParty}` : "",
    `Secciones A3 con información: ${a3Sections.join(", ") || "Ninguna"}`,
    `Documentos indexados para consulta: ${documents.length}`,
    ...documents.map(
      (document) =>
        `Documento ${document.code} - ${document.title}${document.version ? `, versión ${document.version}` : ""}${document.excerpt ? `: ${document.excerpt}` : ""}`,
    ),
  ].filter(Boolean);

  return {
    problem: input.problem,
    context: contextLines.join("\n"),
    source: input.source,
    analysis: input.analysis,
    contextSources: {
      processId: process?.id,
      processName: process?.name,
      parentProcessName: parentProcess?.name,
      documentFamilies,
      documents,
      a3Sections,
    },
  };
}

function findProcess(area: string) {
  const normalizedArea = normalize(area);
  if (!normalizedArea) return undefined;

  return (
    processCatalog.find((process) => normalize(process.name) === normalizedArea) ??
    processCatalog.find(
      (process) =>
        normalize(process.name).includes(normalizedArea) ||
        normalizedArea.includes(normalize(process.name)),
    )
  );
}

function getCompletedA3Sections(analysis?: A3Analysis): string[] {
  if (!analysis) return [];

  const sections = [
    analysis.eventType ? "Apertura" : "",
    analysis.severityJustification ? "Severidad" : "",
    Object.values(analysis.fiveW2H).some(Boolean) ? "5W2H" : "",
    analysis.brainstorm.length ? "Lluvia de ideas" : "",
    Object.values(analysis.ishikawa).flat().length ? "Ishikawa 6M" : "",
    analysis.nonDetectionCause || analysis.rootCause ? "Causas" : "",
    [...analysis.nonDetectionWhys, ...analysis.rootCauseWhys].some(Boolean)
      ? "5 Porqués"
      : "",
    analysis.plans.some((plan) => plan.description) ? "Plan de acción" : "",
  ];

  return sections.filter(Boolean);
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");
}
