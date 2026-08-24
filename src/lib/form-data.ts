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
  objective: string;
  categoryField: string;
  metricField?: string;
  trendInsightId: string;
  insights: AppFormInsightDefinition[];
}

export type AppFormInsightKind =
  | "average"
  | "sum"
  | "rate"
  | "count"
  | "top";

export interface AppFormInsightDefinition {
  id: string;
  label: string;
  kind: AppFormInsightKind;
  fieldId: string;
  matchValue?: string;
  attentionBelow?: number;
  attentionAbove?: number;
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
  insights: AppFormInsightSnapshot[];
  resultTrend: Array<{ label: string; value: number }>;
  resultTrendLabel: string;
  resultTrendSuffix: string;
  keyFindings: string[];
}

export interface AppFormInsightSnapshot {
  id: string;
  label: string;
  value: string;
  numericValue: number | null;
  suffix: string;
  detail: string;
  tone: "positive" | "attention" | "neutral";
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
      objective: "Identificar avance comercial, calidad de las visitas y cuentas que requieren seguimiento.",
      categoryField: "result",
      metricField: "satisfaction",
      trendInsightId: "agreement-rate",
      insights: [
        { id: "agreement-rate", label: "Acuerdos logrados", kind: "rate", fieldId: "result", matchValue: "Acuerdo", attentionBelow: 60 },
        { id: "satisfaction-average", label: "Calificación promedio", kind: "average", fieldId: "satisfaction", attentionBelow: 80 },
        { id: "follow-up", label: "Visitas en seguimiento", kind: "count", fieldId: "result", matchValue: "Seguimiento", attentionAbove: 2 },
        { id: "top-customer", label: "Cliente con más visitas", kind: "top", fieldId: "customer" },
      ],
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
      objective: "Priorizar el impacto de no calidad, los hallazgos recurrentes y los casos que exigen seguimiento.",
      categoryField: "findingType",
      metricField: "rejectedQuantity",
      trendInsightId: "rejected-total",
      insights: [
        { id: "rejected-total", label: "Cantidad rechazada", kind: "sum", fieldId: "rejectedQuantity", attentionAbove: 40 },
        { id: "open-cases", label: "Casos abiertos", kind: "count", fieldId: "$status", matchValue: "Abierto", attentionAbove: 0 },
        { id: "follow-up-cases", label: "En seguimiento", kind: "count", fieldId: "$status", matchValue: "En seguimiento", attentionAbove: 0 },
        { id: "main-finding", label: "Hallazgo dominante", kind: "top", fieldId: "findingType" },
      ],
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
      objective: "Vigilar la liberación de arranques, los ajustes requeridos y el volumen realmente verificado.",
      categoryField: "result",
      metricField: "meters",
      trendInsightId: "release-rate",
      insights: [
        { id: "release-rate", label: "Arranques liberados", kind: "rate", fieldId: "result", matchValue: "Liberado", attentionBelow: 80 },
        { id: "verified-meters", label: "Metros verificados", kind: "sum", fieldId: "meters" },
        { id: "adjustments", label: "Ajustes requeridos", kind: "count", fieldId: "result", matchValue: "Ajuste requerido", attentionAbove: 0 },
        { id: "most-reviewed-loom", label: "Telar más revisado", kind: "top", fieldId: "loom" },
      ],
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
  const insightDefinitions = form.dashboard.insights ?? [];
  const insights = insightDefinitions.map((definition) =>
    calculateInsight(form, form.records, definition),
  );
  const trendDefinition =
    insightDefinitions.find(
      (definition) => definition.id === form.dashboard.trendInsightId,
    ) ?? insightDefinitions.find((definition) => definition.kind !== "top");
  const trendSnapshot = trendDefinition
    ? calculateInsight(form, form.records, trendDefinition)
    : null;
  const categoryBreakdown = countValues(
    form.records.map((record) =>
      String(record.values[form.dashboard.categoryField] ?? "Sin dato"),
    ),
  );

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
    categoryBreakdown,
    insights,
    resultTrend: trendDefinition
      ? buildMonthlyResultTrend(form, trendDefinition, asOf)
      : [],
    resultTrendLabel: trendDefinition?.label ?? "Tendencia",
    resultTrendSuffix: trendSnapshot?.suffix ?? "",
    keyFindings: buildKeyFindings(insights, categoryBreakdown),
  };
}

export function generateDashboardDefinition(
  form: AppFormDefinition,
  objective: string,
  generatedAt = new Date().toISOString(),
  fields?: {
    categoryField?: string;
    metricField?: string;
  },
): AppFormDashboardDefinition {
  const categoryField =
    form.fields.find((field) => field.id === fields?.categoryField) ??
    form.fields.find((field) => field.type === "select") ??
    form.fields[0];
  const metricField =
    form.fields.find((field) => field.id === fields?.metricField) ??
    form.fields.find((field) => field.type === "number");
  const preferredValue = getPreferredResultValue(categoryField?.options ?? []);
  const insights: AppFormInsightDefinition[] = [];

  if (categoryField && preferredValue) {
    insights.push({
      id: "primary-rate",
      label: `% ${preferredValue}`,
      kind: "rate",
      fieldId: categoryField.id,
      matchValue: preferredValue,
    });
  }
  if (metricField) {
    insights.push({
      id: "metric-average",
      label: `Promedio · ${metricField.label}`,
      kind: "average",
      fieldId: metricField.id,
    });
    insights.push({
      id: "metric-total",
      label: `Total · ${metricField.label}`,
      kind: "sum",
      fieldId: metricField.id,
    });
  }
  if (categoryField) {
    insights.push({
      id: "top-result",
      label: `${categoryField.label} dominante`,
      kind: "top",
      fieldId: categoryField.id,
    });
  }

  return {
    ...form.dashboard,
    agentName: "Agente vibecoding de formularios",
    generatedAt,
    version: form.dashboard.version + 1,
    objective:
      objective.trim() ||
      `Resumir los resultados clave de ${form.name} para facilitar decisiones del proceso.`,
    categoryField: categoryField?.id ?? form.fields[0]?.id ?? "",
    metricField: metricField?.id,
    trendInsightId: insights.find((insight) => insight.kind !== "top")?.id ?? "",
    insights: insights.slice(0, 4),
  };
}

export function createDraftAppForm({
  id,
  registrationNumber,
  name,
  processId,
  createdAt,
}: {
  id: string;
  registrationNumber: string;
  name: string;
  processId: string;
  createdAt: string;
}): AppFormDefinition {
  const form: AppFormDefinition = {
    id,
    registrationNumber: registrationNumber.trim().toLocaleUpperCase("es-MX"),
    name: name.trim(),
    processId,
    version: 0,
    status: "Borrador",
    fields: [
      { id: "captureDate", label: "Fecha", type: "date", required: true },
      {
        id: "result",
        label: "Resultado",
        type: "select",
        required: true,
        options: ["Conforme", "Requiere atención"],
      },
    ],
    records: [],
    dashboard: {
      id: `AG-DASH-${registrationNumber.replaceAll(" ", "-").toLocaleUpperCase("es-MX")}`,
      agentName: "Agente vibecoding de formularios",
      generatedAt: createdAt,
      version: 0,
      objective: "",
      categoryField: "result",
      trendInsightId: "",
      insights: [],
    },
  };
  return {
    ...form,
    dashboard: generateDashboardDefinition(form, "", createdAt),
  };
}

export function createImportedAppForm({
  id,
  registrationNumber,
  name,
  processId,
  fields,
  createdAt,
}: {
  id: string;
  registrationNumber: string;
  name: string;
  processId: string;
  fields: AppFormField[];
  createdAt: string;
}) {
  const base = createDraftAppForm({
    id,
    registrationNumber,
    name,
    processId,
    createdAt,
  });
  const form = { ...base, fields };
  return {
    ...form,
    dashboard: generateDashboardDefinition(form, "", createdAt),
  };
}

export function normalizeAppForms(forms: AppFormDefinition[]) {
  return forms.map((form) => {
    if (form.dashboard.objective && form.dashboard.insights?.length) return form;
    const generated = generateDashboardDefinition(
      {
        ...form,
        dashboard: {
          ...form.dashboard,
          objective: form.dashboard.objective ?? "",
          trendInsightId: form.dashboard.trendInsightId ?? "",
          insights: form.dashboard.insights ?? [],
        },
      },
      "",
      form.dashboard.generatedAt,
    );
    return {
      ...form,
      dashboard: { ...generated, version: form.dashboard.version },
    };
  });
}

function calculateInsight(
  form: AppFormDefinition,
  records: AppFormRecord[],
  definition: AppFormInsightDefinition,
): AppFormInsightSnapshot {
  const field = form.fields.find((item) => item.id === definition.fieldId);
  const values = records.map((record) => getRecordValue(record, definition.fieldId));
  const numericValues = values.filter((value): value is number => typeof value === "number");
  let numericValue: number | null = null;
  let value = "Sin datos";
  let suffix = "";
  let detail = "Sin resultados disponibles";

  if (definition.kind === "average") {
    numericValue = numericValues.length
      ? numericValues.reduce((total, item) => total + item, 0) / numericValues.length
      : null;
    value = numericValue === null ? "Sin datos" : formatDashboardNumber(numericValue);
    suffix = field?.unit ?? "";
    detail = `${numericValues.length} resultados considerados`;
  } else if (definition.kind === "sum") {
    numericValue = numericValues.reduce((total, item) => total + item, 0);
    value = formatDashboardNumber(numericValue);
    suffix = field?.unit ?? "";
    detail = `${numericValues.length} resultados acumulados`;
  } else if (definition.kind === "rate") {
    const matches = values.filter((item) => String(item) === definition.matchValue).length;
    numericValue = records.length ? (matches / records.length) * 100 : 0;
    value = formatDashboardNumber(numericValue);
    suffix = "%";
    detail = `${matches} de ${records.length} con resultado ${definition.matchValue}`;
  } else if (definition.kind === "count") {
    const matches = definition.matchValue
      ? values.filter((item) => String(item) === definition.matchValue).length
      : values.filter((item) => item !== "" && item !== undefined).length;
    numericValue = matches;
    value = String(matches);
    detail = definition.matchValue
      ? `Resultado: ${definition.matchValue}`
      : `${matches} resultados con dato`;
  } else {
    const breakdown = countValues(values.map((item) => String(item || "Sin dato")));
    const top = breakdown[0];
    value = top?.label ?? "Sin datos";
    numericValue = top?.value ?? 0;
    detail = top ? `${top.value} resultados` : "Sin resultados disponibles";
  }

  const requiresAttention =
    numericValue !== null &&
    ((definition.attentionBelow !== undefined && numericValue < definition.attentionBelow) ||
      (definition.attentionAbove !== undefined && numericValue > definition.attentionAbove));

  return {
    id: definition.id,
    label: definition.label,
    value,
    numericValue,
    suffix,
    detail,
    tone: requiresAttention ? "attention" : numericValue === null ? "neutral" : "positive",
  };
}

function buildMonthlyResultTrend(
  form: AppFormDefinition,
  definition: AppFormInsightDefinition,
  asOf: Date,
) {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (5 - index), 1));
    const records = form.records.filter((record) => {
      const recordDate = new Date(record.createdAt);
      return recordDate.getUTCFullYear() === date.getUTCFullYear() && recordDate.getUTCMonth() === date.getUTCMonth();
    });
    return {
      label: new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" }).format(date).replace(".", ""),
      value: calculateInsight(form, records, definition).numericValue ?? 0,
    };
  });
}

function buildKeyFindings(
  insights: AppFormInsightSnapshot[],
  categoryBreakdown: Array<{ label: string; value: number }>,
) {
  const findings = insights
    .filter((insight) => insight.tone === "attention")
    .map((insight) => `${insight.label}: ${insight.value}${insight.suffix ? ` ${insight.suffix}` : ""}.`);
  const categoryTotal = categoryBreakdown.reduce((total, item) => total + item.value, 0);
  const top = categoryBreakdown[0];
  if (top && categoryTotal) {
    findings.push(`${top.label} concentra ${formatDashboardNumber((top.value / categoryTotal) * 100)}% de los resultados.`);
  }
  if (!findings.length && insights[0]) {
    findings.push(`${insights[0].label}: ${insights[0].value}${insights[0].suffix ? ` ${insights[0].suffix}` : ""}.`);
  }
  return findings.slice(0, 3);
}

function getRecordValue(record: AppFormRecord, fieldId: string) {
  return fieldId === "$status" ? record.status : record.values[fieldId];
}

function getPreferredResultValue(options: string[]) {
  return ["Liberado", "Acuerdo", "Conforme", "Aprobado", "Cerrado"].find((value) => options.includes(value)) ?? options[0];
}

function formatDashboardNumber(value: number) {
  return value.toLocaleString("es-MX", { maximumFractionDigits: 1 });
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
