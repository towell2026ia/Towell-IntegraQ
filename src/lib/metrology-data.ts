import { getAssetDueStatus } from "@/lib/domain";
import type { MeasurementAsset } from "@/lib/types";

export const metrologyAgent = {
  id: "agt_6a4d760221b88191a27fe0136660278a",
  name: "MetrologyCheckAI",
  url: "https://chatgpt.com/agents/a/agt_6a4d760221b88191a27fe0136660278a",
} as const;

export interface VerificationReadiness {
  ready: boolean;
  reference?: MeasurementAsset;
  references: MeasurementAsset[];
  currentReferences: MeasurementAsset[];
  reason: string;
}

export function getVerificationReadiness(
  asset: MeasurementAsset,
  assets: MeasurementAsset[],
  today: string,
): VerificationReadiness {
  if (asset.activity !== "verification") {
    return {
      ready: true,
      references: [],
      currentReferences: [],
      reason: "Servicio de calibración externa.",
    };
  }

  const referenceIds = asset.referenceStandardIds?.length
    ? asset.referenceStandardIds
    : asset.referenceStandardId
      ? [asset.referenceStandardId]
      : [];
  const references = referenceIds
    .map((id) => assets.find((candidate) => candidate.id === id && candidate.isReferenceStandard))
    .filter((candidate): candidate is MeasurementAsset => Boolean(candidate));
  const currentReferences = references.filter(
    (reference) => !reference.schedulePending && getAssetDueStatus(reference, today) !== "overdue",
  );
  const reference = currentReferences[0] ?? references[0];

  if (!references.length) {
    return {
      ready: false,
      references,
      currentReferences,
      reason: "No tiene un patrón interno asignado.",
    };
  }
  if (!currentReferences.length) {
    return {
      ready: false,
      reference,
      references,
      currentReferences,
      reason: references.length === 1
        ? `El patrón ${reference.code} está vencido.`
        : `Los ${references.length} patrones asignados están vencidos.`,
    };
  }
  return {
    ready: true,
    reference,
    references,
    currentReferences,
    reason: references.length === 1
      ? `Patrón ${reference.code} vigente.`
      : `${currentReferences.length} de ${references.length} patrones asignados están vigentes.`,
  };
}

export function getCurrentReferenceStandards(
  assets: MeasurementAsset[],
  today: string,
) {
  return assets.filter(
    (asset) => asset.isReferenceStandard && !asset.schedulePending && getAssetDueStatus(asset, today) !== "overdue",
  );
}

export function normalizeMeasurementAssets(
  savedAssets: MeasurementAsset[],
  referenceCatalog: MeasurementAsset[] = [],
) {
  const catalogById = new Map(referenceCatalog.map((asset) => [asset.id, asset]));
  const enrichedSaved = savedAssets.map((asset) => {
    const catalogAsset = catalogById.get(asset.id);
    return catalogAsset ? {
      ...catalogAsset,
      ...asset,
      isReferenceStandard: asset.isReferenceStandard ?? catalogAsset.isReferenceStandard,
      referenceStandardId: asset.referenceStandardId ?? catalogAsset.referenceStandardId,
      referenceStandardIds: asset.referenceStandardIds ?? catalogAsset.referenceStandardIds,
      externalProvider: asset.externalProvider ?? catalogAsset.externalProvider,
    } : asset;
  });
  const withCatalog = [
    ...enrichedSaved,
    ...referenceCatalog.filter((catalogAsset) => !enrichedSaved.some((asset) => asset.id === catalogAsset.id)),
  ];

  return withCatalog.map((asset) => {
    const legacyActivity = asset.activity as MeasurementAsset["activity"] | "both";
    const inferredReference = asset.referenceStandardId ?? inferReferenceId(asset.standard);
    const inferredReferences = asset.referenceStandardIds?.length
      ? asset.referenceStandardIds
      : inferredReference
        ? [inferredReference]
        : [];
    const activity: MeasurementAsset["activity"] = !asset.isReferenceStandard && inferredReferences.length
      ? "verification"
      : legacyActivity === "both"
        ? "verification"
        : legacyActivity;
    if (activity === "calibration") {
      return {
        ...asset,
        activity,
        referenceStandardId: undefined,
        referenceStandardIds: undefined,
        externalProvider: asset.externalProvider ?? "Proveedor de calibración acreditado",
      };
    }

    return {
      ...asset,
      activity,
      referenceStandardId: inferredReferences[0],
      referenceStandardIds: inferredReferences,
      externalProvider: undefined,
    };
  });
}

export function buildMetrologyAgentContext(
  asset: MeasurementAsset | undefined,
  assets: MeasurementAsset[],
  today: string,
  request: string,
) {
  if (!asset) return request.trim();
  const dueStatus = getAssetDueStatus(asset, today);
  const readiness = getVerificationReadiness(asset, assets, today);
  const support = asset.activity === "verification"
    ? readiness.references.length
      ? `${readiness.references.map((reference) => `${reference.code} - ${reference.name}`).join("; ")}. ${readiness.reason}`
      : readiness.reason
    : asset.externalProvider ?? "Proveedor no definido";
  const technicalData = [
    asset.measurementCategory || asset.measurementType,
    asset.model ? `modelo ${asset.model}` : "",
    asset.serialNumber ? `serie ${asset.serialNumber}` : "",
    asset.measurementRange ? `alcance ${asset.measurementRange}` : "",
    asset.resolution ? `resolución ${asset.resolution}` : "",
  ].filter(Boolean).join(", ");

  return [
    `Consulta para ${metrologyAgent.name}.`,
    `Equipo: ${asset.code} - ${asset.name}.`,
    technicalData ? `Datos técnicos: ${technicalData}.` : "",
    `Ubicación: ${asset.location}. Responsable: ${asset.owner}.`,
    `Alcance: ${asset.activity === "verification" ? "verificación interna" : "calibración externa"}.`,
    `Soporte metrológico: ${support}.`,
    `Última ejecución: ${asset.lastCompletedAt}. Próxima fecha: ${asset.nextDueDate}. Estado: ${dueStatus}.`,
    `Método o referencia: ${asset.standard}.`,
    `Solicitud: ${request.trim() || "Revisa la aptitud metrológica y recomienda los siguientes pasos."}`,
    asset.observations ? `Observaciones: ${asset.observations}.` : "",
  ].filter(Boolean).join("\n");
}

function inferReferenceId(standard: string) {
  const normalized = standard.toLocaleLowerCase("es-MX");
  if (normalized.includes("placa blanca")) return "standard-white-tile";
  if (normalized.includes("pt-100") || normalized.includes("pt100")) return "standard-pt100";
  if (normalized.includes("bloques patrón") || normalized.includes("bloques patron")) return "standard-gauge-blocks";
  if (normalized.includes("pesas patrón") || normalized.includes("pesas patron") || normalized.includes("clase f1")) return "standard-f1-weights";
  return undefined;
}
