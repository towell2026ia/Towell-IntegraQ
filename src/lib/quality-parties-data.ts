export type CustomerQualityRecord = {
  id: string;
  code: string;
  name: string;
  claims: number;
  findings: number;
  openActions: number;
  nextExternalAudit: string;
  certificates: number;
};

export type SupplierQualityRecord = {
  id: string;
  code: string;
  name: string;
  category: string;
  rncpTotal: number;
  rncpClosed: number;
  rncpLate: number;
  rncpOpen: number;
  effectiveness: number | null;
  auditRequired: boolean;
  nextAudit: string | null;
};

export type SupplierAuditCalendarEvent = {
  id: string;
  supplierCode: string;
  supplierName: string;
  qualityLevel: number;
  date: string;
  status: "Programada" | "Realizada" | "Pendiente" | "Cancelada";
};

export type SupplierAuditSemester = {
  id: "semester-1-2026" | "semester-2-2026";
  label: string;
  period: string;
  months: readonly { year: number; month: number }[];
  events: SupplierAuditCalendarEvent[];
};

export const customerQualityCatalog: CustomerQualityRecord[] = [
  {
    id: "customer-001",
    code: "CLI-001",
    name: "Cliente corporativo A",
    claims: 1,
    findings: 1,
    openActions: 1,
    nextExternalAudit: "2026-09-22",
    certificates: 3,
  },
  {
    id: "customer-002",
    code: "CLI-002",
    name: "Cliente exportación B",
    claims: 0,
    findings: 2,
    openActions: 1,
    nextExternalAudit: "2026-11-05",
    certificates: 2,
  },
  {
    id: "customer-003",
    code: "CLI-003",
    name: "Cliente retail C",
    claims: 0,
    findings: 0,
    openActions: 0,
    nextExternalAudit: "2027-01-19",
    certificates: 2,
  },
];

type SupplierSeed = readonly [code: string, name: string, category: string];

const supplierSeeds: SupplierSeed[] = [
  ["PR00350", "Industrial Jecal, S.A. de C.V.", "QAC"],
  ["PR01168", "Diproquin", "QAC"],
  ["PR00736", "Productos Químicos Básicos", "QAC"],
  ["PR02253", "Eksa Mills", "QAC"],
  ["PR00465", "Química Hernández Ramírez", "QAC"],
  ["PR02413", "Rudolf Chemicals", "QAC"],
  ["PR02504", "Dacamex", "QAC"],
  ["PR00341", "Farbitex", "QAC"],
  ["PR02304", "Industria Técnica Textil", "QAC"],
  ["PR02311", "CB Química - Almidón", "Almidón"],
  ["PR02373", "CB Química - Resina", "Resina"],
  ["PR02589", "Auxitex Solutions", "Auxiliares"],
  ["PR02604", "Industrias Polyvac", "Colorantes"],
  ["035-A", "Anáhuac - Algodón anillo", "Hilaza"],
  ["035-OE", "Anáhuac - Open End", "Hilaza"],
  ["065", "Hilaturas Jiutepec", "Hilaza"],
  ["012", "PYT Textil", "Hilaza"],
  ["022", "DJ Global", "Torzal"],
  ["063-T", "Triton Industrial", "Hilaza"],
  ["063-P", "Portatex", "Hilaza"],
  ["076", "TTM", "Hilaza"],
  ["105", "United Dragon", "Hilaza"],
  ["102", "Antex Textil", "Hilaza"],
  ["099", "Estiel", "Poliéster"],
  ["025", "Filafil", "Hilaza"],
  ["084", "Hilados de Alta Calidad", "Rayón"],
  ["049", "Kamafil", "Poliéster"],
  ["098", "Parra Jaramillo", "Rayón"],
  ["104", "Sajitex", "Poliéster"],
  ["021", "Turbo Yarn", "Hilaza"],
  ["004", "Zagis", "Hilaza"],
  ["007-G", "Gonzalo García", "Torzal"],
  ["007-L", "Lombartex", "Torzal"],
  ["015", "Puentedey", "Hilo de costura"],
  ["005", "Ferale", "Hilo de costura"],
  ["006", "Albricia", "Hilo de costura"],
  ["023", "La Confianza", "Torzal"],
  ["S/N-01", "Teñidos Terry", "Hilaza"],
  ["PR02494", "Progressive Label de México", "Avíos"],
  ["PR00015", "Etiquetas Industriales", "Avíos"],
  ["PR02345", "Impresos Personalizados", "Avíos"],
  ["PR01381", "North American Packaging", "Avíos"],
  ["PR01443", "Top Label", "Avíos"],
  ["PR02083", "Etikame", "Avíos"],
  ["PR00091", "EXE Etiquetas Tejidas", "Avíos"],
  ["PR02400", "Etiquetas Bordadas Mundiales", "Avíos"],
  ["PR02145", "Etiquetas Flexo", "Avíos"],
  ["PR02507", "Premium PKG", "Avíos"],
  ["PR01047", "Textiles Brito", "Avíos"],
  ["PR02449", "VICMA", "Avíos"],
  ["PR02377", "Fabricantes de Cintas El Elefante", "Avíos"],
  ["103", "Kinob Traders", "Hilo"],
  ["PR02472", "Crea Diseño & Imprenta", "Avíos"],
  ["S/N-02", "Estampados Camarasa", "Avíos"],
  ["PR00810", "Etiflex", "Avíos"],
  ["101", "Skytex México", "Hilo"],
  ["106", "Grupo Comercial Nuzca", "Hilo"],
  ["PR02570", "Carlos Arturo Suárez Morales", "Avíos"],
  ["PR01165", "Subliexpress", "Avíos"],
  ["S/N-03", "Plastintlax", "Avíos"],
  ["PR02698", "Decorados y Sublimados", "Avíos"],
  ["S/N-04", "Poli-Tlax", "Avíos"],
];

const supplierHistory: Record<
  string,
  Partial<Pick<SupplierQualityRecord, "rncpTotal" | "rncpClosed" | "rncpLate" | "rncpOpen" | "effectiveness" | "auditRequired" | "nextAudit">>
> = {
  "065": { rncpTotal: 24, rncpClosed: 15, rncpLate: 9, effectiveness: 94.8, nextAudit: "2026-09-18" },
  "035-A": { rncpTotal: 16, rncpClosed: 14, rncpLate: 2, effectiveness: 97.2, nextAudit: "2026-10-09" },
  "PR02449": { rncpTotal: 8, rncpClosed: 4, rncpLate: 4, effectiveness: 91.5, nextAudit: "2026-08-28" },
  "063-T": { rncpTotal: 14, rncpClosed: 11, rncpLate: 3, effectiveness: 95.1, nextAudit: "2026-11-13" },
  "PR02504": { rncpTotal: 3, rncpClosed: 2, rncpLate: 1, effectiveness: 98.4, nextAudit: "2026-12-04" },
  "025": { rncpTotal: 8, rncpClosed: 5, rncpLate: 3, effectiveness: 96.8, nextAudit: "2026-09-04" },
  "PR00341": { rncpTotal: 6, rncpClosed: 6, effectiveness: 99.3, auditRequired: false, nextAudit: null },
  "105": { rncpTotal: 6, rncpClosed: 4, rncpLate: 1, rncpOpen: 1, effectiveness: 92.7, nextAudit: "2026-08-21" },
  "023": { rncpTotal: 12, rncpClosed: 8, rncpLate: 4, effectiveness: 93.9, nextAudit: "2026-10-23" },
  "PR00736": { rncpTotal: 3, rncpClosed: 3, effectiveness: 99.1, auditRequired: false, nextAudit: null },
  "PR02589": { rncpTotal: 2, rncpClosed: 2, effectiveness: 99.6, auditRequired: false, nextAudit: null },
  "005": { rncpTotal: 9, rncpClosed: 9, effectiveness: 99.4, auditRequired: false, nextAudit: null },
  "PR02507": { rncpTotal: 9, rncpClosed: 9, effectiveness: 99.2, auditRequired: false, nextAudit: null },
  "012": { rncpTotal: 6, rncpClosed: 6, effectiveness: 98.9, auditRequired: false, nextAudit: null },
  "022": { rncpTotal: 4, rncpClosed: 2, rncpOpen: 2, effectiveness: 90.8, nextAudit: "2026-08-14" },
  "PR02145": { rncpTotal: 10, rncpClosed: 6, rncpLate: 4, effectiveness: 92.4, nextAudit: "2026-09-25" },
};

export const supplierQualityCatalog: SupplierQualityRecord[] = supplierSeeds.map(
  ([code, name, category], index) => {
    const history = supplierHistory[code] ?? {};
    return {
      id: `supplier-${String(index + 1).padStart(3, "0")}`,
      code,
      name,
      category,
      rncpTotal: history.rncpTotal ?? 0,
      rncpClosed: history.rncpClosed ?? 0,
      rncpLate: history.rncpLate ?? 0,
      rncpOpen: history.rncpOpen ?? 0,
      effectiveness: history.effectiveness ?? null,
      auditRequired: history.auditRequired ?? true,
      nextAudit: history.nextAudit ?? null,
    };
  },
);

export const supplierAuditSemesters: SupplierAuditSemester[] = [
  {
    id: "semester-1-2026",
    label: "Semestre 1",
    period: "Febrero - julio 2026",
    months: [
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
      { year: 2026, month: 4 },
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
    ],
    events: [
      { id: "AUD-S1-01", supplierCode: "065", supplierName: "Hilaturas Jiutepec", qualityLevel: 93.51, date: "2026-02-19", status: "Realizada" },
      { id: "AUD-S1-02", supplierCode: "PR00015", supplierName: "Etiquetas Industriales", qualityLevel: 92.5, date: "2026-04-17", status: "Realizada" },
      { id: "AUD-S1-03", supplierCode: "PR02472", supplierName: "Crea Diseño & Imprenta", qualityLevel: 90.5, date: "2026-04-24", status: "Realizada" },
      { id: "AUD-S1-04", supplierCode: "005", supplierName: "Ferale", qualityLevel: 97.39, date: "2026-05-15", status: "Realizada" },
      { id: "AUD-S1-05", supplierCode: "PR02145", supplierName: "Etiquetas Flexo", qualityLevel: 73.9, date: "2026-06-12", status: "Cancelada" },
      { id: "AUD-S1-06", supplierCode: "035-A", supplierName: "Anáhuac", qualityLevel: 83.3, date: "2026-06-19", status: "Realizada" },
      { id: "AUD-S1-07", supplierCode: "PR02449", supplierName: "VICMA", qualityLevel: 50, date: "2026-07-10", status: "Pendiente" },
      { id: "AUD-S1-08", supplierCode: "063-T", supplierName: "Triton Industrial", qualityLevel: 92.98, date: "2026-07-24", status: "Realizada" },
    ],
  },
  {
    id: "semester-2-2026",
    label: "Semestre 2",
    period: "Agosto 2026 - enero 2027",
    months: [
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2027, month: 0 },
    ],
    events: [
      { id: "AUD-S2-01", supplierCode: "022", supplierName: "DJ Global", qualityLevel: 80, date: "2026-08-28", status: "Programada" },
      { id: "AUD-S2-02", supplierCode: "PR00465", supplierName: "Química Hernández Ramírez", qualityLevel: 98.46, date: "2026-09-11", status: "Programada" },
      { id: "AUD-S2-03", supplierCode: "PR02145", supplierName: "Etiquetas Flexo", qualityLevel: 89.29, date: "2026-09-25", status: "Programada" },
      { id: "AUD-S2-04", supplierCode: "PR02698", supplierName: "Decorados y Sublimados", qualityLevel: 71.43, date: "2026-10-16", status: "Programada" },
      { id: "AUD-S2-05", supplierCode: "PR02507", supplierName: "Premium PKG", qualityLevel: 93.55, date: "2026-11-06", status: "Programada" },
      { id: "AUD-S2-06", supplierCode: "PR02449", supplierName: "VICMA", qualityLevel: 80, date: "2026-11-27", status: "Programada" },
      { id: "AUD-S2-07", supplierCode: "065", supplierName: "Hilaturas Jiutepec", qualityLevel: 99.14, date: "2026-12-18", status: "Programada" },
    ],
  },
];

export const rncpDashboardSummary = {
  total: 204,
  closed: 158,
  late: 43,
  inProcess: 3,
  byMaterial: [
    { label: "Auxiliares", value: 8 },
    { label: "Colorantes", value: 17 },
    { label: "Químicos", value: 7 },
  ],
  bySupplierStatus: [
    { label: "Jiutepec", closed: 15, late: 9, inProcess: 0 },
    { label: "Anáhuac", closed: 14, late: 2, inProcess: 0 },
    { label: "Triton", closed: 11, late: 3, inProcess: 0 },
    { label: "VICMA", closed: 4, late: 4, inProcess: 0 },
    { label: "Filafil", closed: 5, late: 3, inProcess: 0 },
    { label: "Dacamex", closed: 2, late: 1, inProcess: 0 },
  ],
  byDate: [
    { label: "17 jul", value: 1 },
    { label: "19 jul", value: 1 },
    { label: "24 jul", value: 1 },
    { label: "26 jul", value: 1 },
    { label: "29 jul", value: 1 },
    { label: "30 jul", value: 2 },
    { label: "31 jul", value: 1 },
    { label: "07 ago", value: 3 },
  ],
  topSuppliers: [
    { label: "Jiutepec", value: 24 },
    { label: "Anáhuac", value: 16 },
    { label: "Triton", value: 14 },
    { label: "La Confianza", value: 12 },
    { label: "Etiq. Flexo", value: 10 },
    { label: "Premium PKG", value: 9 },
  ],
};

export const externalAuditCalendar = [
  { id: "AUD-EXT-026", party: "Cliente corporativo A", date: "2026-09-22", scope: "Sistema de calidad", status: "Programada" },
  { id: "AUD-EXT-027", party: "Cliente exportación B", date: "2026-11-05", scope: "Producto y trazabilidad", status: "Programada" },
  { id: "AUD-CER-011", party: "Organismo certificador", date: "2027-02-16", scope: "Seguimiento de certificación", status: "Planeada" },
];

export const activeCertifications = [
  { name: "ISO 9001", certificate: "Certificado del SGC", validUntil: "2027-06-30" },
  { name: "OEKO-TEX", certificate: "Standard 100", validUntil: "2027-01-31" },
  { name: "Certificado fiscal", certificate: "Constancia vigente", validUntil: "2026-12-31" },
];
