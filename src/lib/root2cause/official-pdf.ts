import { jsPDF } from "jspdf";

export interface RootCausePdfEvidence {
  name: string;
  mime: string;
  sha256: string;
  imagePng?: Uint8Array;
}

export interface RootCausePdfInput {
  folio: string;
  title: string;
  problem: string;
  source: string;
  severity: string;
  area: string;
  process: string;
  owner: string;
  reportDate: string;
  dueDate: string;
  customer: string;
  externalReference: string;
  analysis: Record<string, unknown>;
  plans: Record<string, unknown>[];
  evidence: RootCausePdfEvidence[];
}

const show = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : "No registrado";

export function buildRootCauseOfficialPdf(input: RootCausePdfInput) {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const margin = 14, width = 182;
  let y = 18;
  const nextPage = () => { pdf.addPage(); y = 18; };
  const ensure = (height: number) => { if (y + height > 278) nextPage(); };
  const header = (label: string) => {
    ensure(17); pdf.setFont("helvetica", "bold"); pdf.setFontSize(10); pdf.setTextColor(20, 55, 80);
    pdf.text(label, margin, y); y += 6; pdf.setDrawColor(130); pdf.line(margin, y, margin + width, y); y += 5;
  };
  const field = (label: string, value: unknown) => {
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(30);
    const lines = pdf.splitTextToSize(`${label}: ${show(value)}`, width - 2) as string[];
    for (const line of lines) {
      ensure(4.5);
      pdf.text(line, margin, y);
      y += 4.5;
    }
    y += 2;
  };
  const list = (label: string, values: unknown[]) => {
    header(label);
    if (!values.length) { field("Contenido", "Sin información registrada"); return; }
    values.forEach((value, index) => field(`${index + 1}`, value));
  };
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); pdf.text(input.folio, margin, y); y += 8;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.text("Análisis de causa raíz · IntegraQ", margin, y); y += 8;
  header("1. Apertura");
  field("Código de acción correctiva", input.folio); field("Fecha del reporte", input.reportDate); field("Descripción", input.title); field("Clasificación", input.source);
  field("Proceso", input.process); field("Área", input.area); field("Cliente", input.customer);
  field("Referencia externa", input.externalReference); field("Responsable", input.owner); field("Fecha compromiso", input.dueDate); field("Problema", input.problem);
  header("2. Severidad"); field("Nivel", input.severity); field("Justificación", input.analysis.severityJustification);
  const fiveW2H = (input.analysis.fiveW2H && typeof input.analysis.fiveW2H === "object" ? input.analysis.fiveW2H : {}) as Record<string, unknown>;
  header("3. 5W2H");
  for (const [key, label] of [["what","Qué"],["why","Por qué"],["where","Dónde"],["when","Cuándo"],["who","Quién"],["how","Cómo"],["howMuch","Cuánto"]]) field(label, fiveW2H[key]);
  list("4. Lluvia de ideas", Array.isArray(input.analysis.brainstorm) ? input.analysis.brainstorm : []);
  const ishikawa = (input.analysis.ishikawa && typeof input.analysis.ishikawa === "object" ? input.analysis.ishikawa : {}) as Record<string, unknown>;
  header("5. Ishikawa 6M");
  for (const [key,label] of [["workforce","Mano de obra"],["machinery","Maquinaria"],["method","Método"],["material","Material"],["environment","Medio ambiente"],["measurement","Medición"]]) {
    field(label, Array.isArray(ishikawa[key]) ? (ishikawa[key] as unknown[]).join("; ") : "Sin causas registradas");
  }
  header("6. Causas"); field("Causa de no detección", input.analysis.nonDetectionCause); field("Causa raíz", input.analysis.rootCause);
  header("7. Cinco Porqués");
  field("No detección", Array.isArray(input.analysis.nonDetectionWhys) ? input.analysis.nonDetectionWhys.join(" → ") : "No registrado");
  field("Causa raíz", Array.isArray(input.analysis.rootCauseWhys) ? input.analysis.rootCauseWhys.join(" → ") : "No registrado");
  header("8. Plan de acción");
  for (const [index, plan] of input.plans.entries()) {
    field(`Acción ${index + 1}`, plan.description); field("Causa que atiende", plan.cause_text ?? plan.cause);
    field("Responsable", plan.owner_name ?? plan.owner); field("Fecha compromiso", plan.due_date ?? plan.dueDate);
    field("Resultado esperado", plan.expected_result ?? plan.expectedResult); field("Evidencia de cumplimiento", plan.completion_evidence ?? plan.completionEvidence);
    field("Criterio de efectividad", plan.effectiveness_method ?? plan.effectivenessMethod); field("Estado", plan.status);
  }
  if (input.evidence.length) {
    header("Evidencias autorizadas del expediente");
    for (const evidence of input.evidence) {
      if (evidence.imagePng) {
        nextPage(); field("Evidencia", evidence.name); field("SHA-256", evidence.sha256);
        const image = pdf.getImageProperties(evidence.imagePng); const maxW = width, maxH = 225;
        const scale = Math.min(maxW / image.width, maxH / image.height); const w = image.width * scale, h = image.height * scale;
        ensure(h + 8); pdf.addImage(evidence.imagePng, "PNG", margin + (width - w) / 2, y, w, h); y += h + 8;
      } else {
        field("Documento original vinculado", evidence.name); field("Tipo documental", evidence.mime); field("SHA-256", evidence.sha256);
        field("Nota", "El original permanece privado en el expediente; su contenido no se modificó.");
      }
    }
  }
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(80);
    pdf.text(`${input.folio} · Página ${page} de ${pdf.getNumberOfPages()}`, margin, 288);
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}
