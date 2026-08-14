"use client";

import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  FilePenLine,
  FileText,
  LockKeyhole,
  Printer,
  RefreshCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";

import {
  approveManagementReviewAsOperations,
  approveManagementReviewAsSgc,
  buildAnnualManagementReviewPeriod,
  buildManagementReviewContext,
  createManagementReviewRecord,
  hasSourceChanges,
  type ManagementReviewAiDraft,
  type ManagementReviewApproval,
  type ManagementReviewRecord,
  type ManagementReviewSources,
} from "@/lib/management-review-data";

interface ManagementReviewModuleProps {
  sources: ManagementReviewSources;
  record: ManagementReviewRecord | null;
  onRecordChange: (record: ManagementReviewRecord) => void;
}

const reviewStatusLabels: Record<ManagementReviewRecord["status"], string> = {
  draft: "Borrador IA",
  sgc_approved: "Autorizada por SGC",
  operations_approved: "Autorización final",
};

export function ManagementReviewModule({
  sources,
  record,
  onRecordChange,
}: ManagementReviewModuleProps) {
  const period = useMemo(
    () => buildAnnualManagementReviewPeriod(new Date().getFullYear()),
    [],
  );
  const context = useMemo(
    () => buildManagementReviewContext(sources, period),
    [period, sources],
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [workingDraft, setWorkingDraft] = useState<ManagementReviewAiDraft | null>(
    record?.draft ?? null,
  );
  const [approvalComment, setApprovalComment] = useState("");

  const displayedSources = record?.sourceSnapshot ?? context.sources;
  const changedAfterGeneration = record ? hasSourceChanges(record, context) : false;
  const isAdministrator = sources.session.userType === "Administrador";
  const isOperationsDirector = normalize(sources.session.position) === normalize("Dirección de Operaciones");
  const connectedCount = displayedSources.filter((source) => source.status === "connected").length;

  const generateReview = async () => {
    if (record || generating || !isAdministrator) return;
    setGenerating(true);
    setError("");
    try {
      const response = await fetch("/api/ai/management-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "management_review", context }),
      });
      const payload = (await response.json()) as ManagementReviewAiDraft & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No fue posible generar la revisión.");
      onRecordChange(createManagementReviewRecord(context, payload));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible generar la revisión.",
      );
    } finally {
      setGenerating(false);
    }
  };

  const startEditing = () => {
    if (!record || record.status !== "draft" || !isAdministrator) return;
    setWorkingDraft(structuredClone(record.draft));
    setEditing(true);
  };

  const saveDraft = () => {
    if (!record || !workingDraft) return;
    onRecordChange({
      ...record,
      draft: workingDraft,
      modifiedAt: new Date().toISOString(),
    });
    setEditing(false);
  };

  const approveAsSgc = () => {
    if (!record) return;
    onRecordChange(
      approveManagementReviewAsSgc(
        record,
        sources.session,
        approvalComment,
        new Date().toISOString(),
      ),
    );
    setApprovalComment("");
    setEditing(false);
  };

  const approveAsOperations = () => {
    if (!record) return;
    onRecordChange(
      approveManagementReviewAsOperations(
        record,
        sources.session,
        approvalComment,
        new Date().toISOString(),
      ),
    );
    setApprovalComment("");
  };

  const updateSection = (sectionId: string, content: string) => {
    if (!workingDraft) return;
    setWorkingDraft({
      ...workingDraft,
      sections: workingDraft.sections.map((section) =>
        section.id === sectionId ? { ...section, content } : section,
      ),
    });
  };

  const updateDecision = (
    decisionId: string,
    field: "description" | "owner" | "dueDate",
    value: string,
  ) => {
    if (!workingDraft) return;
    setWorkingDraft({
      ...workingDraft,
      decisions: workingDraft.decisions.map((decision) =>
        decision.id === decisionId ? { ...decision, [field]: value } : decision,
      ),
    });
  };

  const draft = editing ? workingDraft : record?.draft;

  return (
    <div className="management-review-module">
      <div className="module-heading management-review-heading print-hidden">
        <div>
          <span className="module-kicker">Gobierno del SGC</span>
          <h2>Revisión ejecutiva generada desde IntegraQ</h2>
          <p>
            Expediente único por periodo, con evidencia congelada, edición controlada y autorización secuencial.
          </p>
        </div>
        <div className="module-heading-actions">
          <span className={`management-review-status status-${record?.status ?? "not-generated"}`}>
            {record ? reviewStatusLabels[record.status] : "Sin generar"}
          </span>
          {!record ? (
            <button
              className="button button-ai"
              type="button"
              disabled={!isAdministrator || generating}
              onClick={generateReview}
            >
              {generating ? <RefreshCcw className="spin" size={16} /> : <Sparkles size={16} />}
              {generating ? "Consolidando fuentes" : "Generar con IA"}
            </button>
          ) : null}
        </div>
      </div>

      <section className="management-source-panel work-panel print-hidden">
        <header className="management-panel-heading">
          <div>
            <span className="module-kicker">Cobertura de evidencia</span>
            <h3>{connectedCount} de {displayedSources.length} fuentes integradas</h3>
          </div>
          <span className="management-context-id"><Database size={14} /> {record?.contextFingerprint ?? context.fingerprint}</span>
        </header>
        <div className="management-source-grid">
          {displayedSources.map((source) => (
            <div className={`management-source-row source-${source.status}`} key={source.id}>
              <span className="management-source-state" title={source.status === "connected" ? "Fuente conectada" : "Fuente pendiente"}>
                {source.status === "connected" ? <Check size={14} /> : <Clock3 size={14} />}
              </span>
              <div>
                <strong>{source.label}</strong>
                <small>{source.status === "connected" ? `${source.recordCount} registros considerados` : "Pendiente de integración"}</small>
              </div>
              {source.metrics.slice(0, 2).map((metric) => (
                <span className={`source-metric metric-${metric.tone ?? "neutral"}`} key={metric.label}>
                  <small>{metric.label}</small><strong>{metric.value}</strong>
                </span>
              ))}
            </div>
          ))}
        </div>
        {changedAfterGeneration ? (
          <div className="management-data-change">
            <AlertCircle size={16} />
            <div>
              <strong>Hay cambios posteriores a la generación</strong>
              <span>El expediente conserva la fotografía original para no alterar una revisión en autorización.</span>
            </div>
          </div>
        ) : null}
      </section>

      {error ? <div className="management-error print-hidden"><AlertCircle size={16} />{error}</div> : null}

      {!record ? (
        <section className="management-empty work-panel">
          <div className="management-empty-icon"><Bot size={26} /></div>
          <span className="module-kicker">{period.label}</span>
          <h3>El expediente todavía no ha sido emitido</h3>
          <p>
            Al generarlo, la IA redactará el resumen y las ocho entradas de revisión con la información disponible. Las fuentes pendientes quedarán declaradas como limitaciones.
          </p>
          <div className="management-flow-preview">
            <span><Sparkles size={15} />Generación única</span>
            <i />
            <span><ShieldCheck size={15} />Autoriza SGC</span>
            <i />
            <span><CheckCircle2 size={15} />Autoriza Operaciones</span>
          </div>
          {!isAdministrator ? <small>Solo el perfil Administrador puede generar este expediente.</small> : null}
        </section>
      ) : (
        <>
          <section className="management-control-strip print-hidden">
            <div><FileText size={17} /><span><small>Expediente</small><strong>{record.id} / Rev. {record.revision}</strong></span></div>
            <div><Database size={17} /><span><small>Corte de información</small><strong>{formatDateTime(record.generatedAt)}</strong></span></div>
            <div><LockKeyhole size={17} /><span><small>Generación</small><strong>Única y bloqueada</strong></span></div>
            <div className="management-control-actions">
              {record.status === "draft" && isAdministrator ? (
                editing ? (
                  <>
                    <button className="button button-secondary" type="button" onClick={() => setEditing(false)}><X size={15} />Cancelar</button>
                    <button className="button button-primary" type="button" onClick={saveDraft}><Save size={15} />Guardar ajustes</button>
                  </>
                ) : (
                  <button className="button button-secondary" type="button" onClick={startEditing}><FilePenLine size={15} />Editar borrador</button>
                )
              ) : null}
              <button className="icon-button" type="button" title="Imprimir o guardar como PDF" onClick={() => window.print()}><Printer size={17} /></button>
            </div>
          </section>

          <article className="management-official-report">
            <header className="management-report-header">
              <Image src="/brand/towell-logo.jpg" alt="Towell" width={180} height={54} priority />
              <div>
                <span>Sistema de Gestión de Calidad</span>
                <h2>Revisión por la Dirección</h2>
                <p>{record.period.label}</p>
              </div>
              <dl>
                <div><dt>Código</dt><dd>{record.id}</dd></div>
                <div><dt>Revisión</dt><dd>{record.revision}</dd></div>
                <div><dt>Fecha</dt><dd>{formatDate(record.generatedAt)}</dd></div>
              </dl>
            </header>

            <section className="management-report-meta">
              <div><small>Empresa</small><strong>{sources.session.company}</strong></div>
              <div><small>Preparó</small><strong>{record.generatedBy}</strong><span>{record.generatedByPosition}</span></div>
              <div><small>Periodo revisado</small><strong>{formatDate(record.period.startDate)} - {formatDate(record.period.endDate)}</strong></div>
              <div><small>Fuentes</small><strong>{connectedCount} integradas</strong><span>{displayedSources.length - connectedCount} pendientes</span></div>
            </section>

            <section className="management-executive-summary">
              <span className="report-section-number">00</span>
              <div>
                <h3>Resumen ejecutivo</h3>
                {editing && workingDraft ? (
                  <textarea
                    value={workingDraft.executiveSummary}
                    onChange={(event) => setWorkingDraft({ ...workingDraft, executiveSummary: event.target.value })}
                    rows={5}
                  />
                ) : <p>{draft?.executiveSummary}</p>}
              </div>
            </section>

            <div className="management-report-sections">
              {draft?.sections.map((section, index) => (
                <section className="management-report-section" key={section.id}>
                  <span className="report-section-number">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{section.title.replace(/^\d+\.\s*/, "")}</h3>
                    {editing ? (
                      <textarea value={section.content} onChange={(event) => updateSection(section.id, event.target.value)} rows={5} />
                    ) : <p>{section.content}</p>}
                    {section.sourceIds.length ? (
                      <div className="management-source-references">
                        {section.sourceIds.map((sourceId) => {
                          const source = displayedSources.find((item) => item.id === sourceId);
                          return source ? <span key={sourceId} className={`reference-${source.status}`}>{source.label}</span> : null;
                        })}
                      </div>
                    ) : null}
                  </div>
                </section>
              ))}
            </div>

            <section className="management-findings">
              <header><h3>Hallazgos clave</h3><span>{draft?.keyFindings.length ?? 0}</span></header>
              <ol>
                {draft?.keyFindings.map((finding, index) => <li key={`${index}-${finding}`}>{finding}</li>)}
              </ol>
            </section>

            <section className="management-decisions">
              <header><h3>Decisiones y compromisos de la Dirección</h3><span>{draft?.decisions.length ?? 0}</span></header>
              <div className="management-decision-table-wrap">
                <table>
                  <thead><tr><th>Decisión</th><th>Responsable</th><th>Fecha compromiso</th><th>Prioridad</th></tr></thead>
                  <tbody>
                    {draft?.decisions.map((decision) => (
                      <tr key={decision.id}>
                        <td><code>{decision.id}</code>{editing ? <textarea value={decision.description} onChange={(event) => updateDecision(decision.id, "description", event.target.value)} rows={3} /> : <strong>{decision.description}</strong>}</td>
                        <td>{editing ? <input value={decision.owner} onChange={(event) => updateDecision(decision.id, "owner", event.target.value)} /> : decision.owner}</td>
                        <td>{editing ? <input type="date" value={decision.dueDate} onChange={(event) => updateDecision(decision.id, "dueDate", event.target.value)} /> : formatDate(decision.dueDate)}</td>
                        <td><span className={`decision-priority priority-${decision.priority.toLocaleLowerCase("es")}`}>{decision.priority}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {draft?.warnings.length ? (
              <section className="management-report-notes">
                <AlertCircle size={17} />
                <div><strong>Notas de control</strong>{draft.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
              </section>
            ) : null}

            <footer className="management-report-footer">
              <span>Contexto: {record.contextFingerprint}</span>
              <span>Generado por IntegraQ {record.draft.mode === "demo" ? "(modo demostración)" : "con IA conectada"}</span>
            </footer>
          </article>

          <section className="management-approval-panel work-panel print-hidden">
            <header className="management-panel-heading">
              <div><span className="module-kicker">Flujo de autorización</span><h3>Secuencia obligatoria</h3></div>
              <span className="management-separation"><LockKeyhole size={14} />Funciones separadas</span>
            </header>
            <div className="management-approval-flow">
              <ApprovalStep
                number="1"
                title="Responsable del SGC"
                detail="Administrador"
                approval={record.approvals[0]}
                active={record.status === "draft"}
              />
              <span className={`approval-connector ${record.approvals[0].status === "approved" ? "complete" : ""}`} />
              <ApprovalStep
                number="2"
                title="Dirección de Operaciones"
                detail="Usuario designado"
                approval={record.approvals[1]}
                active={record.status === "sgc_approved"}
              />
              <span className={`approval-connector ${record.status === "operations_approved" ? "complete" : ""}`} />
              <div className={`management-approval-step final-step ${record.status === "operations_approved" ? "step-complete" : ""}`}>
                <span>{record.status === "operations_approved" ? <CheckCircle2 size={17} /> : <LockKeyhole size={17} />}</span>
                <div><strong>Acta autorizada</strong><small>Registro final bloqueado</small></div>
              </div>
            </div>

            {record.status !== "operations_approved" ? (
              <div className="management-approval-action">
                <label>
                  <span>Comentario de autorización</span>
                  <textarea value={approvalComment} onChange={(event) => setApprovalComment(event.target.value)} placeholder="Observaciones para la siguiente etapa" rows={3} />
                </label>
                {record.status === "draft" ? (
                  <button className="button button-primary" type="button" disabled={!isAdministrator || editing} onClick={approveAsSgc}>
                    <Send size={16} />Autorizar y enviar a Operaciones
                  </button>
                ) : (
                  <button className="button button-primary" type="button" disabled={!isOperationsDirector} onClick={approveAsOperations}>
                    <CheckCircle2 size={16} />Autorizar revisión
                  </button>
                )}
                <p>
                  {record.status === "draft"
                    ? "La autorización del SGC bloquea la edición y habilita la segunda firma."
                    : isOperationsDirector
                      ? "Esta sesión corresponde a Dirección de Operaciones."
                      : "Pendiente de ingreso del usuario con puesto Dirección de Operaciones."}
                </p>
              </div>
            ) : (
              <div className="management-finalized"><CheckCircle2 size={19} /><div><strong>Revisión autorizada</strong><span>Las dos etapas fueron completadas y el expediente quedó bloqueado.</span></div></div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ApprovalStep({
  number,
  title,
  detail,
  approval,
  active,
}: {
  number: string;
  title: string;
  detail: string;
  approval: ManagementReviewApproval;
  active: boolean;
}) {
  const complete = approval.status === "approved";
  return (
    <div className={`management-approval-step ${complete ? "step-complete" : active ? "step-active" : "step-locked"}`}>
      <span>{complete ? <Check size={17} /> : number}</span>
      <div>
        <strong>{title}</strong>
        <small>{complete ? `${approval.approverName} · ${formatDateTime(approval.approvedAt ?? "")}` : detail}</small>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  if (!value) return "Pendiente";
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function formatDateTime(value: string) {
  if (!value) return "Pendiente";
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

