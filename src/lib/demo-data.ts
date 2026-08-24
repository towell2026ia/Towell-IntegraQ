import type { CorrectiveAction, MeasurementAsset } from "@/lib/types";
import { measurementAssetCatalog } from "@/lib/metrology-catalog";

export const demoCorrectiveActions: CorrectiveAction[] = [
  {
    id: "ca-001",
    folio: "AC-2026-014",
    title: "Variación de tono en lote de tintorería",
    problem:
      "El lote T-1847 presentó una diferencia de tono fuera del estándar al finalizar el proceso de tintorería.",
    source: "internal",
    severity: "high",
    area: "Tintorería",
    owner: "Mariana López",
    createdAt: "2026-07-08",
    dueDate: "2026-08-06",
    status: "analysis",
    progress: 30,
    evidenceCount: 4,
  },
  {
    id: "ca-002",
    folio: "AC-2026-013",
    title: "Reincidencia en peso fuera de especificación",
    problem:
      "Tres rollos del pedido 8291 fueron rechazados por peso menor al especificado.",
    source: "customer",
    severity: "critical",
    area: "Tejido",
    owner: "Carlos Méndez",
    createdAt: "2026-06-19",
    dueDate: "2026-07-18",
    status: "implementation",
    progress: 68,
    evidenceCount: 7,
    relatedParty: "Cliente corporativo A",
    relatedPartyId: "customer-001",
    rootCause:
      "El ajuste de tensión no se verifica después de cambios de turno.",
    a3: {
      eventType: "Reclamo de cliente",
      severityJustification:
        "El rechazo afecta producto entregado, continuidad del pedido y satisfacción del cliente.",
      fiveW2H: {
        what: "Rollos con peso menor al valor especificado.",
        why: "El incumplimiento generó rechazo del pedido y riesgo de reincidencia.",
        where: "Proceso de tejido y verificación final del pedido 8291.",
        when: "Durante la liberación de tres rollos del pedido.",
        who: "Operación de tejido, supervisión y liberación de calidad.",
        how: "La tensión quedó fuera del ajuste nominal después del cambio de turno.",
        howMuch: "Tres rollos rechazados.",
      },
      brainstorm: [
        "Ajuste de tensión sin confirmación al iniciar turno",
        "Instrucción de arranque incompleta",
        "Muestreo de peso insuficiente durante el proceso",
      ],
      ishikawa: {
        workforce: ["El relevo de turno no confirma el ajuste"],
        machinery: ["El valor de tensión no genera una alerta"],
        method: ["La lista de arranque no exige registrar la tensión"],
        material: [],
        environment: [],
        measurement: ["La frecuencia de verificación no cubre el cambio de turno"],
      },
      nonDetectionCause:
        "La verificación de peso se ejecuta al final y no inmediatamente después del cambio de turno.",
      rootCause:
        "El ajuste de tensión no se verifica después de cambios de turno.",
      nonDetectionWhys: [
        "El plan de control no define una revisión posterior al relevo.",
        "La condición de cambio de turno no se consideró un punto de riesgo.",
        "El análisis del proceso se elaboró con una sola condición de arranque.",
        "",
        "",
      ],
      rootCauseWhys: [
        "El operador entrante conserva el ajuste recibido.",
        "El relevo no incluye un dato objetivo de tensión.",
        "La instrucción no establece quién debe verificarlo.",
        "",
        "",
      ],
      plans: [
        {
          id: "plan-ca-002-1",
          description:
            "Agregar la confirmación de tensión y peso a la lista de arranque y cambio de turno.",
          owner: "Carlos Méndez",
          dueDate: "2026-07-12",
          status: "completed",
        },
        {
          id: "plan-ca-002-2",
          description:
            "Verificar la eficacia durante tres cambios de turno consecutivos.",
          owner: "Mariana López",
          dueDate: "2026-07-18",
          status: "in_progress",
        },
      ],
    },
  },
  {
    id: "ca-003",
    folio: "AC-2026-012",
    title: "Documento obsoleto en punto de uso",
    problem:
      "Durante auditoría interna se encontró una instrucción de trabajo obsoleta en el área de acabado.",
    source: "audit",
    severity: "medium",
    area: "Acabado",
    owner: "Fernanda Ruiz",
    createdAt: "2026-06-28",
    dueDate: "2026-07-31",
    status: "effectiveness",
    progress: 88,
    evidenceCount: 5,
    rootCause:
      "El retiro de copias controladas no forma parte del cierre de cambio documental.",
  },
  {
    id: "ca-004",
    folio: "AC-2026-011",
    title: "Entrega incompleta de certificado de proveedor",
    problem:
      "El proveedor entregó materia prima sin el certificado requerido por la especificación de compra.",
    source: "supplier",
    severity: "medium",
    area: "Compras",
    owner: "Karen Silva",
    createdAt: "2026-05-16",
    dueDate: "2026-06-16",
    status: "closed",
    progress: 100,
    evidenceCount: 6,
    relatedParty: "United Dragon",
    relatedPartyId: "supplier-022",
    rootCause:
      "La orden de compra no incluía el requisito documental como condición de recepción.",
  },
];

export function enrichSavedCorrectiveActions(
  savedActions: CorrectiveAction[],
): CorrectiveAction[] {
  const demoById = new Map(
    demoCorrectiveActions.map((action) => [action.id, action]),
  );

  return savedActions.map((savedAction) => {
    const demoAction = demoById.get(savedAction.id);
    if (!demoAction) return savedAction;

    return {
      ...demoAction,
      ...savedAction,
      relatedParty: savedAction.relatedParty ?? demoAction.relatedParty,
      relatedPartyId: savedAction.relatedPartyId ?? demoAction.relatedPartyId,
      a3: savedAction.a3 ?? demoAction.a3,
    };
  });
}

export const demoMeasurementAssets = measurementAssetCatalog;

/** @deprecated Datos de maqueta conservados sólo como referencia de migración. */
export const legacyMeasurementAssets: MeasurementAsset[] = [
  {
    id: "asset-001",
    code: "EQ-MET-023",
    name: "Báscula de plataforma 1,500 kg",
    location: "Almacén de crudo",
    owner: "José Lara",
    activity: "calibration",
    frequencyMonths: 12,
    lastCompletedAt: "2025-07-18",
    nextDueDate: "2026-07-18",
    evidenceCount: 2,
    standard: "Calibración de alcance completo bajo ISO/IEC 17025",
    externalProvider: "Laboratorio acreditado de masa",
  },
  {
    id: "asset-002",
    code: "EQ-LAB-011",
    name: "Espectrofotómetro",
    location: "Laboratorio de color",
    owner: "Ana Torres",
    activity: "verification",
    frequencyMonths: 3,
    lastCompletedAt: "2026-05-02",
    nextDueDate: "2026-08-02",
    evidenceCount: 8,
    standard: "Placa blanca certificada",
    referenceStandardId: "standard-white-tile",
  },
  {
    id: "asset-003",
    code: "EQ-PRO-047",
    name: "Termómetro digital de proceso",
    location: "Tintorería",
    owner: "Miguel Nava",
    activity: "verification",
    frequencyMonths: 6,
    lastCompletedAt: "2026-03-14",
    nextDueDate: "2026-09-14",
    evidenceCount: 4,
    standard: "Termómetro patrón PT-100",
    referenceStandardId: "standard-pt100",
  },
  {
    id: "asset-004",
    code: "EQ-CAL-008",
    name: "Calibrador Vernier 0-150 mm",
    location: "Calidad",
    owner: "Laura Campos",
    activity: "verification",
    frequencyMonths: 1,
    lastCompletedAt: "2026-07-10",
    nextDueDate: "2026-08-10",
    evidenceCount: 12,
    standard: "Bloques patrón grado 1",
    referenceStandardId: "standard-gauge-blocks",
  },
  {
    id: "asset-005",
    code: "EQ-MET-031",
    name: "Báscula de mesa 30 kg",
    location: "Empaque",
    owner: "Daniel Vega",
    activity: "verification",
    frequencyMonths: 12,
    lastCompletedAt: "2025-08-24",
    nextDueDate: "2026-08-24",
    evidenceCount: 1,
    standard: "Pesas patrón clase F1",
    referenceStandardId: "standard-f1-weights",
  },
  {
    id: "standard-white-tile",
    code: "PAT-COL-001",
    name: "Placa blanca certificada",
    location: "Laboratorio de color",
    owner: "Ana Torres",
    activity: "calibration",
    frequencyMonths: 12,
    lastCompletedAt: "2026-01-15",
    nextDueDate: "2027-01-15",
    evidenceCount: 3,
    standard: "Certificado de reflectancia trazable",
    isReferenceStandard: true,
    externalProvider: "Laboratorio acreditado de color",
  },
  {
    id: "standard-pt100",
    code: "PAT-TEM-002",
    name: "Termómetro patrón PT-100",
    location: "Laboratorio de calidad",
    owner: "Laura Campos",
    activity: "calibration",
    frequencyMonths: 12,
    lastCompletedAt: "2026-02-20",
    nextDueDate: "2027-02-20",
    evidenceCount: 2,
    standard: "Certificado de temperatura trazable",
    isReferenceStandard: true,
    externalProvider: "Laboratorio acreditado de temperatura",
  },
  {
    id: "standard-gauge-blocks",
    code: "PAT-DIM-003",
    name: "Juego de bloques patrón grado 1",
    location: "Laboratorio de calidad",
    owner: "Laura Campos",
    activity: "calibration",
    frequencyMonths: 12,
    lastCompletedAt: "2026-04-05",
    nextDueDate: "2027-04-05",
    evidenceCount: 4,
    standard: "Certificado dimensional trazable",
    isReferenceStandard: true,
    externalProvider: "Laboratorio acreditado dimensional",
  },
  {
    id: "standard-f1-weights",
    code: "PAT-MAS-004",
    name: "Juego de pesas patrón clase F1",
    location: "Laboratorio de calidad",
    owner: "José Lara",
    activity: "calibration",
    frequencyMonths: 12,
    lastCompletedAt: "2026-06-12",
    nextDueDate: "2027-06-12",
    evidenceCount: 5,
    standard: "Certificado de masa trazable",
    isReferenceStandard: true,
    externalProvider: "Laboratorio acreditado de masa",
  },
];
