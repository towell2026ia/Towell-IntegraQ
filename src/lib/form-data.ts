export type AppFormFieldType =
  | "text"
  | "number"
  | "date"
  | "select"
  | "textarea";

export type AppFormValue = string | number;

export interface AppFormField {
  id: string;
  label: string;
  type: AppFormFieldType;
  required: boolean;
  options?: string[];
  unit?: string;
}

export interface AppFormRecord {
  id: string;
  createdAt: string;
  status: string;
  values: Record<string, AppFormValue>;
}

export interface AppFormDashboardDefinition {
  id: string;
  agentName: string;
  generatedAt: string;
  version: number;
  categoryField: string;
  metricField?: string;
}

export interface AppFormDefinition {
  id: string;
  registrationNumber: string;
  name: string;
  processId: string;
  version: number;
  status: "Activo" | "Borrador";
  fields: AppFormField[];
  records: AppFormRecord[];
  dashboard: AppFormDashboardDefinition;
}

export interface AppFormDashboardSnapshot {
  totalRecords: number;
  recordsThisMonth: number;
  metricAverage: number | null;
  metricLabel: string | null;
  lastRecordAt: string | null;
  monthlyTrend: Array<{ label: string; value: number }>;
  statusBreakdown: Array<{ label: string; value: number }>;
  categoryBreakdown: Array<{ label: string; value: number }>;
}

export const appFormCatalog: AppFormDefinition[] = [
  {
    id: "FORM-VE-01",
    registrationNumber: "F-VE-12",
    name: "Registro de visita y seguimiento comercial",
    processId: "P-01",
    version: 1,
    status: "Activo",
    fields: [
      { id: "visitDate", label: "Fecha de visita", type: "date", required: true },
      { id: "customer", label: "Cliente", type: "text", required: true },
      {
        id: "channel",
        label: "Canal",
        type: "select",
        required: true,
        options: ["Presencial", "Videollamada", "Teléfono"],
      },
      {
        id: "result",
        label: "Resultado",
        type: "select",
        required: true,
        options: ["Acuerdo", "Seguimiento", "Sin avance"],
      },
      { id: "satisfaction", label: "Calificación", type: "number", required: true, unit: "/ 100" },
      { id: "notes", label: "Observaciones", type: "textarea", required: false },
    ],
    records: [
      {
        id: "REG-F-VE-12-0001",
        createdAt: "2026-05-14T16:10:00.000Z",
        status: "Cerrado",
        values: { visitDate: "2026-05-14", customer: "Hotel Central", channel: "Presencial", result: "Acuerdo", satisfaction: 92, notes: "Muestra aprobada." },
      },
      {
        id: "REG-F-VE-12-0002",
        createdAt: "2026-06-09T18:35:00.000Z",
        status: "Cerrado",
        values: { visitDate: "2026-06-09", customer: "Grupo Norte", channel: "Videollamada", result: "Seguimiento", satisfaction: 84, notes: "Validar volumen anual." },
      },
      {
        id: "REG-F-VE-12-0003",
        createdAt: "2026-06-25T15:20:00.000Z",
        status: "Cerrado",
        values: { visitDate: "2026-06-25", customer: "Casa Azul", channel: "Presencial", result: "Acuerdo", satisfaction: 96, notes: "Cotización enviada." },
      },
      {
        id: "REG-F-VE-12-0004",
        createdAt: "2026-07-17T17:05:00.000Z",
        status: "En seguimiento",
        values: { visitDate: "2026-07-17", customer: "Hospital San José", channel: "Videollamada", result: "Seguimiento", satisfaction: 78, notes: "Pendiente ficha técnica." },
      },
      {
        id: "REG-F-VE-12-0005",
        createdAt: "2026-08-04T16:45:00.000Z",
        status: "Cerrado",
        values: { visitDate: "2026-08-04", customer: "Hotel Central", channel: "Teléfono", result: "Acuerdo", satisfaction: 90, notes: "Pedido confirmado." },
      },
      {
        id: "REG-F-VE-12-0006",
        createdAt: "2026-08-10T19:15:00.000Z",
        status: "En seguimiento",
        values: { visitDate: "2026-08-10", customer: "Grupo Horizonte", channel: "Presencial", result: "Sin avance", satisfaction: 72, notes: "Revisar condiciones comerciales." },
      },
    ],
    dashboard: {
      id: "AG-DASH-F-VE-12",
      agentName: "Agente de análisis documental",
      generatedAt: "2026-05-12T15:00:00.000Z",
      version: 1,
      categoryField: "result",
      metricField: "satisfaction",
    },
  },
  {
    id: "FORM-CA-25",
    registrationNumber: "F-CA-25",
    name: "Reporte de No Calidad Proveedores",
    processId: "P-08",
    version: 2,
    status: "Activo",
    fields: [
      { id: "reportDate", label: "Fecha del reporte", type: "date", required: true },
      { id: "supplier", label: "Proveedor", type: "text", required: true },
      { id: "purchaseOrder", label: "Orden de compra", type: "text", required: true },
      {
        id: "findingType",
        label: "Tipo de hallazgo",
        type: "select",
        required: true,
        options: ["Materia prima", "Empaque", "Documentación", "Entrega"],
      },
      { id: "rejectedQuantity", label: "Cantidad rechazada", type: "number", required: true, unit: "pzas" },
      { id: "description", label: "Descripción", type: "textarea", required: true },
    ],
    records: [
      {
        id: "REG-F-CA-25-0041",
        createdAt: "2026-06-18T14:12:00.000Z",
        status: "Cerrado",
        values: { reportDate: "2026-06-18", supplier: "Textiles del Centro", purchaseOrder: "OC-260618", findingType: "Materia prima", rejectedQuantity: 18, description: "Variación de tono fuera de muestra." },
      },
      {
        id: "REG-F-CA-25-0042",
        createdAt: "2026-07-08T13:40:00.000Z",
        status: "En seguimiento",
        values: { reportDate: "2026-07-08", supplier: "Empaques Unidos", purchaseOrder: "OC-260701", findingType: "Empaque", rejectedQuantity: 42, description: "Caja sin resistencia especificada." },
      },
      {
        id: "REG-F-CA-25-0043",
        createdAt: "2026-08-06T16:20:00.000Z",
        status: "Abierto",
        values: { reportDate: "2026-08-06", supplier: "Químicos Industriales", purchaseOrder: "OC-260802", findingType: "Documentación", rejectedQuantity: 1, description: "Certificado de análisis incompleto." },
      },
    ],
    dashboard: {
      id: "AG-DASH-F-CA-25",
      agentName: "Agente de calidad de proveedores",
      generatedAt: "2026-06-18T14:20:00.000Z",
      version: 1,
      categoryField: "findingType",
      metricField: "rejectedQuantity",
    },
  },
  {
    id: "FORM-TE-01",
    registrationNumber: "F-TE-01",
    name: "Verificación de arranque de tejido",
    processId: "P-16",
    version: 1,
    status: "Activo",
    fields: [
      { id: "inspectionDate", label: "Fecha de verificación", type: "date", required: true },
      { id: "loom", label: "Telar", type: "text", required: true },
      { id: "style", label: "Estilo", type: "text", required: true },
      {
        id: "result",
        label: "Resultado",
        type: "select",
        required: true,
        options: ["Liberado", "Ajuste requerido", "Detenido"],
      },
      { id: "meters", label: "Metros verificados", type: "number", required: true, unit: "m" },
      { id: "observations", label: "Observaciones", type: "textarea", required: false },
    ],
    records: [
      {
        id: "REG-F-TE-01-0118",
        createdAt: "2026-07-29T12:32:00.000Z",
        status: "Cerrado",
        values: { inspectionDate: "2026-07-29", loom: "T-18", style: "TO-500-B", result: "Liberado", meters: 15, observations: "Parámetros dentro de estándar." },
      },
      {
        id: "REG-F-TE-01-0119",
        createdAt: "2026-08-03T11:18:00.000Z",
        status: "Cerrado",
        values: { inspectionDate: "2026-08-03", loom: "T-07", style: "TO-700-W", result: "Ajuste requerido", meters: 12, observations: "Ajuste de tensión de trama." },
      },
      {
        id: "REG-F-TE-01-0120",
        createdAt: "2026-08-09T13:05:00.000Z",
        status: "Cerrado",
        values: { inspectionDate: "2026-08-09", loom: "T-22", style: "TO-450-G", result: "Liberado", meters: 18, observations: "Arranque liberado." },
      },
    ],
    dashboard: {
      id: "AG-DASH-F-TE-01",
      agentName: "Agente de manufactura",
      generatedAt: "2026-07-29T12:40:00.000Z",
      version: 1,
      categoryField: "result",
      metricField: "meters",
    },
  },
];

export function getFormsForProcess(processId: string) {
  return appFormCatalog.filter((form) => form.processId === processId);
}

export function serializeFormRecordsToCsv(form: AppFormDefinition) {
  const headers = [
    "Registro",
    "Fecha de captura",
    "Estado",
    ...form.fields.map((field) => field.label),
  ];
  const rows = form.records.map((record) => [
    record.id,
    record.createdAt,
    record.status,
    ...form.fields.map((field) => record.values[field.id] ?? ""),
  ]);

  return `\uFEFF${[headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\r\n")}`;
}

export function buildFormDashboard(
  form: AppFormDefinition,
  asOf = new Date(),
): AppFormDashboardSnapshot {
  const recordsThisMonth = form.records.filter((record) => {
    const date = new Date(record.createdAt);
    return (
      date.getUTCFullYear() === asOf.getUTCFullYear() &&
      date.getUTCMonth() === asOf.getUTCMonth()
    );
  }).length;

  const metricField = form.fields.find(
    (field) => field.id === form.dashboard.metricField,
  );
  const metricValues = form.records
    .map((record) => record.values[form.dashboard.metricField ?? ""])
    .filter((value): value is number => typeof value === "number");

  const latestRecord = [...form.records].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )[0];

  return {
    totalRecords: form.records.length,
    recordsThisMonth,
    metricAverage: metricValues.length
      ? metricValues.reduce((total, value) => total + value, 0) /
        metricValues.length
      : null,
    metricLabel: metricField?.label ?? null,
    lastRecordAt: latestRecord?.createdAt ?? null,
    monthlyTrend: buildMonthlyTrend(form.records, asOf),
    statusBreakdown: countValues(form.records.map((record) => record.status)),
    categoryBreakdown: countValues(
      form.records.map((record) =>
        String(record.values[form.dashboard.categoryField] ?? "Sin dato"),
      ),
    ),
  };
}

function buildMonthlyTrend(records: AppFormRecord[], asOf: Date) {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (5 - index), 1),
    );
    const value = records.filter((record) => {
      const recordDate = new Date(record.createdAt);
      return (
        recordDate.getUTCFullYear() === date.getUTCFullYear() &&
        recordDate.getUTCMonth() === date.getUTCMonth()
      );
    }).length;

    return {
      label: new Intl.DateTimeFormat("es-MX", {
        month: "short",
        timeZone: "UTC",
      })
        .format(date)
        .replace(".", ""),
      value,
    };
  });
}

function countValues(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function escapeCsvValue(value: AppFormValue | string) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
