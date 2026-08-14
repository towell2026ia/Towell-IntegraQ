"use client";

import { ArrowLeft, Download, FileText } from "lucide-react";
import type { ReactNode } from "react";

import { getCorrectiveActionLabel } from "@/lib/domain";
import type {
  A3Analysis,
  CorrectiveAction,
  CorrectiveActionSeverity,
  CorrectiveActionSource,
} from "@/lib/types";

const sourceLabels: Record<CorrectiveActionSource, string> = {
  internal: "Interna",
  audit: "Sistema de gestión de calidad",
  customer: "Externa / cliente",
  supplier: "Proveedor",
};

const severityLabels: Record<CorrectiveActionSeverity, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

const ishikawaLabels: Record<keyof A3Analysis["ishikawa"], string> = {
  workforce: "Mano de obra",
  machinery: "Maquinaria",
  method: "Método",
  material: "Material",
  environment: "Medio ambiente",
  measurement: "Medición",
};

export function A3ActionReport({
  action,
  onBack,
  children,
}: {
  action: CorrectiveAction;
  onBack: () => void;
  children?: ReactNode;
}) {
  const analysis = action.a3;
  const fiveW2H = analysis
    ? [
        ["Qué", analysis.fiveW2H.what],
        ["Por qué", analysis.fiveW2H.why],
        ["Dónde", analysis.fiveW2H.where],
        ["Cuándo", analysis.fiveW2H.when],
        ["Quién", analysis.fiveW2H.who],
        ["Cómo", analysis.fiveW2H.how],
        ["Cuánto", analysis.fiveW2H.howMuch],
      ]
    : [];

  return (
    <section className="a3-report-shell">
      <div className="a3-report-toolbar print-hidden">
        <button className="button button-ghost" type="button" onClick={onBack}>
          <ArrowLeft size={16} /> Volver al listado
        </button>
        <div>
          {children}
          <button className="button button-primary" type="button" onClick={() => window.print()}>
            <Download size={16} /> Exportar PDF
          </button>
        </div>
      </div>

      <article className="a3-official-report">
        <header className="a3-report-header">
          <div className="a3-report-brand">
            <span aria-hidden="true">T</span>
            <div><strong>TOWELL</strong><small>Sistema de Gestión de Calidad</small></div>
          </div>
          <div className="a3-report-title">
            <small>Reporte resumido</small>
            <h2>Acción Correctiva / Análisis A3</h2>
          </div>
          <dl>
            <div><dt>Folio</dt><dd>{action.folio}</dd></div>
            <div><dt>Versión</dt><dd>V0</dd></div>
            <div><dt>Estado</dt><dd>{getCorrectiveActionLabel(action.status)}</dd></div>
          </dl>
        </header>

        <div className="a3-report-control-band">
          <div><small>Acción</small><strong>{action.title}</strong></div>
          <div><small>Proceso</small><strong>{action.area}</strong></div>
          <div><small>Responsable</small><strong>{action.owner}</strong></div>
          <div><small>Avance</small><strong>{action.progress}%</strong></div>
        </div>

        <ReportSection number="1" title="Apertura y descripción del problema">
          <div className="a3-report-opening">
            <ReportFact label="Tipo de evento" value={analysis?.eventType} />
            <ReportFact label="Origen" value={sourceLabels[action.source]} />
            <ReportFact label="Fecha de apertura" value={formatDate(action.createdAt)} />
            <ReportFact label="Fecha compromiso" value={formatDate(action.dueDate)} />
            {action.relatedParty ? <ReportFact label="Cliente relacionado" value={action.relatedParty} /> : null}
            <div className="wide"><small>Descripción integral</small><p>{action.problem}</p></div>
          </div>
        </ReportSection>

        <ReportSection number="2" title="Evaluación de severidad">
          <div className="a3-report-severity">
            <span className={`severity-badge severity-${action.severity}`}>{severityLabels[action.severity]}</span>
            <p>{analysis?.severityJustification || "Pendiente de justificar la severidad."}</p>
          </div>
        </ReportSection>

        <ReportSection number="3" title="Definición 5W2H">
          {fiveW2H.length ? (
            <dl className="a3-report-5w2h">
              {fiveW2H.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Pendiente"}</dd></div>)}
            </dl>
          ) : <PendingSection />}
        </ReportSection>

        <ReportSection number="4" title="Lluvia de ideas">
          {analysis?.brainstorm.length ? (
            <ol className="a3-report-numbered-list">{analysis.brainstorm.map((idea) => <li key={idea}>{idea}</li>)}</ol>
          ) : <PendingSection />}
        </ReportSection>

        <ReportSection number="5" title="Ishikawa 6M">
          {analysis ? (
            <div className="a3-report-ishikawa">
              {(Object.keys(ishikawaLabels) as (keyof A3Analysis["ishikawa"])[]).map((key) => (
                <section key={key}><h4>{ishikawaLabels[key]}</h4>{analysis.ishikawa[key].length ? <ul>{analysis.ishikawa[key].map((cause) => <li key={cause}>{cause}</li>)}</ul> : <span>Sin causas registradas</span>}</section>
              ))}
            </div>
          ) : <PendingSection />}
        </ReportSection>

        <ReportSection number="6" title="Causa de no detección y causa raíz">
          {analysis ? (
            <div className="a3-report-causes">
              <div><small>Causa de no detección</small><p>{analysis.nonDetectionCause || "Pendiente"}</p></div>
              <div><small>Causa raíz de ocurrencia</small><p>{analysis.rootCause || "Pendiente"}</p></div>
            </div>
          ) : <PendingSection />}
        </ReportSection>

        <ReportSection number="7" title="Cinco Porqués">
          {analysis ? (
            <div className="a3-report-whys">
              <WhysColumn title="No detección" values={analysis.nonDetectionWhys} />
              <WhysColumn title="Causa raíz" values={analysis.rootCauseWhys} />
            </div>
          ) : <PendingSection />}
        </ReportSection>

        <ReportSection number="8" title="Plan de acción">
          {analysis?.plans.length ? (
            <div className="a3-report-table-wrap">
              <table><thead><tr><th>Acción</th><th>Responsable</th><th>Compromiso</th><th>Estado</th></tr></thead><tbody>{analysis.plans.map((plan) => <tr key={plan.id}><td>{plan.description || "Pendiente"}</td><td>{plan.owner || "Pendiente"}</td><td>{formatDate(plan.dueDate)}</td><td>{plan.status === "completed" ? "Completada" : plan.status === "in_progress" ? "En proceso" : "Pendiente"}</td></tr>)}</tbody></table>
            </div>
          ) : <PendingSection />}
        </ReportSection>

        <footer className="a3-report-footer">
          <span><FileText size={14} /> {action.folio}</span>
          <span>Copia controlada para consulta · IntegraQ</span>
        </footer>
      </article>
    </section>
  );
}

function ReportSection({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <section className="a3-report-section"><header><span>{number}</span><h3>{title}</h3></header><div>{children}</div></section>;
}

function ReportFact({ label, value }: { label: string; value?: string }) {
  return <div><small>{label}</small><strong>{value || "Pendiente"}</strong></div>;
}

function PendingSection() {
  return <div className="a3-report-pending">Pendiente de captura en el análisis A3.</div>;
}

function WhysColumn({ title, values }: { title: string; values: string[] }) {
  const completed = values.filter((value) => value.trim());
  return <section><h4>{title}</h4>{completed.length ? <ol>{completed.map((value, index) => <li key={`${value}-${index}`}><span>Por qué {index + 1}</span><p>{value}</p></li>)}</ol> : <span>Sin respuestas registradas</span>}</section>;
}

function formatDate(value?: string) {
  if (!value) return "Pendiente";
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
