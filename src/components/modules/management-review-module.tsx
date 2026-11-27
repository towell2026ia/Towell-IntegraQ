"use client";

import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  Eye,
  FilePenLine,
  FileText,
  LockKeyhole,
  Printer,
  Save,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import {
  approveManagementReviewAsOperations,
  approveManagementReviewAsSgc,
  type ManagementReviewAiDraft,
  type ManagementReviewApproval,
  type ManagementReviewRecord,
} from "@/lib/management-review-data";
import { ManagementReviewMinutes, useReviewMinutes } from "./management-review-minutes";
import { hasUnsavedChanges } from "@/lib/workspace-continuity";
import { getDocumentPermissions } from "@/lib/document-control-data";
import { ReviewOutputs } from "./review-outputs";
import { outputYears } from "@/lib/review-output-storage";
import { ReviewDocuments } from "./review-documents";
import { canAccessModule } from "@/lib/access-policy";
import { useContinuityState } from "@/components/workspace-continuity";
import { ReviewReturnButton, canReturnFromReview } from "./review-return-button";
import { managementReviewGroups, type ReviewSection } from "@/lib/management-review-sections";
import styles from "./management-review-portal.module.css";
import { isExternalUser, type ActiveSession } from "@/lib/session-data";

interface ManagementReviewModuleProps {
  session: ActiveSession;
  onOpenSection?: (section: ReviewSection, year: number) => void;
  legacyPending?: boolean;
  recordsReady: boolean;
  sourcesChanged?: (record: ManagementReviewRecord) => boolean;
  recordsError?: boolean;
  onRetryRecords?: () => void;
  records: ManagementReviewRecord[];
  onRecordChange: (previous: ManagementReviewRecord, next: ManagementReviewRecord) => void;
}

const reviewStatusLabels: Record<ManagementReviewRecord["status"], string> = {
  draft: "Borrador IA",
  sgc_approved: "Pendiente de aprobación",
  operations_approved: "Cerrada",
};

export function ManagementReviewModule(props: ManagementReviewModuleProps) {
  if (isExternalUser(props.session) || !canAccessModule(props.session, "management-review")) return null;
  return <ManagementReviewWorkspace {...props} />;
}

function ManagementReviewWorkspace({ session, records, legacyPending, onRecordChange, sourcesChanged, recordsReady, recordsError, onRetryRecords, onOpenSection }: ManagementReviewModuleProps) {
  const [period, setPeriod] = useContinuityState("review:period", () => new Date().getFullYear());
  const [view, setView] = useState<"portal" | "history" | "attachments" | "acuerdos">("portal");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const catalog = useReviewMinutes(session);
  const [agreementYears,setAgreementYears]=useState<number[]>();
  const [outputsFailed,setOutputsFailed]=useState(false);
  const [retryOutputs,setRetryOutputs]=useState(0);
  useEffect(()=>{let active=true;outputYears().then(years=>{if(active){setAgreementYears(years);setOutputsFailed(false);}})
    .catch(()=>{if(active)setOutputsFailed(true);});return()=>{active=false;};},[retryOutputs]);
  const manualAllowed = getDocumentPermissions(session, "P-35").view;
  const [editing, setEditing] = useState(false);
  const [workingDraft, setWorkingDraft] = useState<ManagementReviewAiDraft | null>(null);
  const [saveError, setSaveError] = useState("");
  const [approvalComment, setApprovalComment] = useState("");
  const record = records.find((item) => item.id === selectedId) ?? null;
  const displayedSources = record?.sourceSnapshot ?? [];
  const isAdministrator = session.userType === "Administrador";
  const isOperationsDirector = normalize(session.position) === normalize("Dirección de Operaciones");
  const connectedCount = displayedSources.filter((source) => source.status === "connected").length;

  const updateRecord = (nextRecord: ManagementReviewRecord) => {
    if (!record) return false;
    try {
      onRecordChange(record, nextRecord);
      setSaveError("");
      return true;
    } catch {
      setSaveError("No se pudo guardar el informe. Conserva tus cambios y comprueba la versión antes de reintentar.");
      return false;
    }
  };

  const startEditing = () => {
    if (!record || record.status !== "draft" || !isAdministrator) return;
    setWorkingDraft(structuredClone(record.draft));
    setEditing(true);
  };

  const saveDraft = () => {
    if (!record || !workingDraft) return;
    if (!updateRecord({
      ...record,
      draft: workingDraft,
      modifiedAt: new Date().toISOString(),
    })) return;
    setEditing(false);
  };

  const approveAsSgc = () => {
    if (!record) return;
    if (!updateRecord(
      approveManagementReviewAsSgc(
        record,
        session,
        approvalComment,
        new Date().toISOString(),
      ),
    )) return;
    setApprovalComment("");
    setEditing(false);
  };

  const approveAsOperations = () => {
    if (!record) return;
    if (!updateRecord(
      approveManagementReviewAsOperations(
        record,
        session,
        approvalComment,
        new Date().toISOString(),
      ),
    )) return;
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
        decision.id === decisionId && !decision.officialDecisionId ? { ...decision, [field]: value } : decision,
      ),
    });
  };

  const allowExit = () => !(editing || approvalComment.trim() || hasUnsavedChanges()) || window.confirm("Hay cambios sin guardar. ¿Deseas salir de esta vista?");
  if (!record) {
    const currentYear = new Date().getFullYear();
    const years = [...new Set([currentYear, period, ...records.map(item => item.period.year),
      ...catalog.years,...(agreementYears??[])])]
      .filter(year => Number.isInteger(year) && year >= 1900 && year <= currentYear)
      .sort((left, right) => right - left);
    return <div className={styles.portal}>
      <header className={styles.header}>
        <div><h2>{view === "portal" ? "Alcance de Dirección" : view === "history" ? "Revisiones anteriores" : view === "acuerdos" ? "Salidas de Revisión por la Dirección" : "Evidencias y adjuntos"}</h2>
          <p>{view === "portal" ? "Consulta los apartados del sistema de gestión para la revisión anual." :
            view === "history" ? "Informes de este navegador y actas históricas del período." : view === "acuerdos" ? "Decisiones, compromisos y seguimiento del período." : "Documentación complementaria del período seleccionado."}</p></div>
        <label className={styles.year}><CalendarDays size={16} />Período
          <select value={period} onChange={event => { if (allowExit()) setPeriod(Number(event.target.value)); }}>{years.map(year => <option key={year}>{year}</option>)}</select>
        </label>
      </header>
      {recordsError && <p role="alert">No se pudieron leer los informes de este navegador. <button type="button" onClick={onRetryRecords}>Reintentar</button></p>}
      {catalog.loading && <progress className={styles.progress} aria-label="Actualizando períodos" />}
      {catalog.loadError && view === "portal" && <p role="alert">No se pudieron consultar los períodos de las actas. <button type="button" onClick={catalog.reload}>Reintentar</button></p>}
      {view === "portal" ? <>
        <div className={styles.groups}>{managementReviewGroups.map(group => <section key={group.group} className={styles.group}>
          <h3>{group.group}</h3><div className={styles.cards}>{group.sections.map(section => {
            const allowed = canAccessModule(session, section.module) && (section.id !== "manual" || manualAllowed);
            const outputs = section.id === "outputs";
            const status = outputs && !agreementYears ? (outputsFailed ? "Información no disponible" : "Comprobando disponibilidad") : section.availability;
            const target = section.view;
            const local = target === "history" || target === "attachments" || target === "acuerdos";
            const available = allowed && (!outputs || !!agreementYears) && (local || (status === "Disponible" && !!onOpenSection));
            const body = <><span className={styles.icon}><section.icon size={19} /></span><span className={styles.copy}>
              <strong>{section.title}</strong><span>{section.description}</span><small>{allowed ? status : "Sin acceso"}</small>
            </span>{available && <ChevronRight size={16} />}</>;
            return available ? <button key={section.id} type="button" className={styles.card} onClick={() => local ? setView(target) : onOpenSection?.(section, period)}>{body}</button> :
              <div key={section.id} className={styles.card}>{body}</div>;
          })}</div>
        </section>)}</div>
        {outputsFailed && <button className="button button-secondary" onClick={()=>setRetryOutputs(n=>n+1)}>Reintentar consulta de salidas</button>}
        <footer className={styles.footer}><button type="button" disabled className="button button-secondary"><Sparkles size={16} />Generar Revisión por la Dirección</button><span>Previsto para RE-05</span></footer>
      </> : <>
        {canReturnFromReview(session, true, "management-review") ? <ReviewReturnButton onReturn={() => { if (allowExit()) setView("portal"); }} /> : <button className="button button-secondary" type="button" onClick={() => {if(allowExit())setView("portal");}}><ArrowLeft size={16} />Alcance de Dirección</button>}
        {view === "history" && legacyPending && isAdministrator && <p>Hay informes locales sin identidad comprobada pendientes de conciliación.</p>}
        {view === "history" && !recordsError && (recordsReady ? <ManagementReviewIndex records={records.filter(item => item.period.year === period)} onOpen={setSelectedId} /> : <progress aria-label="Cargando informes" />)}
        {view === "acuerdos" ? <ReviewOutputs key={period} year={period} onYearsChanged={year=>{setAgreementYears(old=>[...new Set([...(old??[]),year])]);setPeriod(year);}}/> : view === "history" ? <ManagementReviewMinutes key={period} session={session} period={period} onYear={setPeriod} catalog={catalog} /> : <ReviewDocuments key={period} session={session} period={period} onYear={setPeriod} catalog={catalog} references={onOpenSection && canAccessModule(session, "documents") ? managementReviewGroups[0].sections.filter(s => s.id === "policy" || (s.id === "manual" && manualAllowed)).map(s => ({name:s.title, open:()=>onOpenSection(s,period)})) : []} />}
      </>}
    </div>;
  }

  const draft = editing ? workingDraft : record?.draft;

  return (
    <div className="management-review-module">
      {canReturnFromReview(session, view === "history", "management-review") && <ReviewReturnButton onReturn={() => {
        if (!allowExit()) return;
        setEditing(false); setSelectedId(null); setView("portal"); setApprovalComment(""); setSaveError("");
      }} />}
      <div className="module-heading management-review-heading print-hidden">
        <div>
          <span className="module-kicker">Gobierno del SGC</span>
          <h2>Revisión ejecutiva generada desde IntegraQ</h2>
          <p>
            Expediente único por periodo, con evidencia congelada, edición controlada y autorización secuencial.
          </p>
        </div>
        <div className="module-heading-actions">
          <button className="button button-secondary" type="button" onClick={() => { if (allowExit()) { setSelectedId(null); setEditing(false); setSaveError(""); setApprovalComment(""); } }}>
            <ArrowLeft size={16} />Historial
          </button>
          <span className={`management-review-status status-${record?.status ?? "not-generated"}`}>
            {record ? reviewStatusLabels[record.status] : "Sin generar"}
          </span>

        </div>
      </div>

      {sourcesChanged?.(record) && <p className="management-data-change"><AlertCircle size={16} />Hay cambios posteriores a la generación. El acta conserva las fuentes de su revisión.</p>}
      {saveError && <p role="alert">{saveError}</p>}
      <section className="management-source-panel work-panel print-hidden">
        <header className="management-panel-heading">
          <div>
            <span className="module-kicker">Cobertura de evidencia</span>
            <h3>{connectedCount} de {displayedSources.length} fuentes integradas</h3>
          </div>
          <span className="management-context-id"><Database size={14} /> {record.contextFingerprint}</span>
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
      </section>
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
              <div><small>Empresa</small><strong>{session.company}</strong></div>
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
                    {draft?.decisions.map((decision) => decision.officialDecisionId ? <tr key={decision.id}><td colSpan={4}>Acuerdo oficial · {decision.officialDecisionId}</td></tr> : (
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

            {record.status === "operations_approved" ? (
              <section className="management-report-signatures">
                {record.approvals.map((approval, index) => (
                  <div key={approval.stage}>
                    <small>{index === 0 ? "Validó el responsable del SGC" : "Aprobó Dirección de Operaciones"}</small>
                    <strong>{approval.approverName}</strong>
                    <span>{approval.approverPosition}</span>
                    <time>{formatDateTime(approval.approvedAt ?? "")}</time>
                  </div>
                ))}
              </section>
            ) : null}

            <footer className="management-report-footer">
              <span>Contexto: {record.contextFingerprint}</span>
              <span>Generado por IntegraQ {record.draft.mode === "demo" ? "(modo demostración)" : "con IA conectada"}</span>
            </footer>
          </article>

          {record.status === "operations_approved" ? (
            <ClosedAuthorizationPanel record={record} />
          ) : (
          <section className="management-approval-panel work-panel print-hidden">
            <header className="management-panel-heading">
              <div><span className="module-kicker">Validación y aprobación</span><h3>Secuencia obligatoria</h3></div>
              <span className="management-separation"><LockKeyhole size={14} />Funciones separadas</span>
            </header>
            <div className="management-approval-flow">
              <ApprovalStep
                number="1"
                title="Validación del SGC"
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
              <span className="approval-connector" />
              <div className="management-approval-step final-step step-locked">
                <span><LockKeyhole size={17} /></span>
                <div><strong>Acta autorizada</strong><small>Registro final bloqueado</small></div>
              </div>
            </div>

            <div className="management-approval-action">
                <label>
                  <span>Comentario de autorización</span>
                  <textarea value={approvalComment} onChange={(event) => setApprovalComment(event.target.value)} placeholder="Observaciones para la siguiente etapa" rows={3} />
                </label>
                {record.status === "draft" ? (
                  <button className="button button-primary" type="button" disabled={!isAdministrator || editing} onClick={approveAsSgc}>
                    <Send size={16} />Validar y enviar a Operaciones
                  </button>
                ) : (
                  <button className="button button-primary" type="button" disabled={!isOperationsDirector} onClick={approveAsOperations}>
                    <CheckCircle2 size={16} />Autorizar revisión
                  </button>
                )}
                <p>
                  {record.status === "draft"
                    ? "La validación del SGC bloquea la edición y habilita la aprobación final."
                    : isOperationsDirector
                      ? "Esta sesión corresponde a Dirección de Operaciones."
                      : "Pendiente de ingreso del usuario con puesto Dirección de Operaciones."}
                </p>
            </div>
          </section>
          )}
    </div>
  );
}

function ManagementReviewIndex({ records, onOpen }: {
  records: ManagementReviewRecord[];
  onOpen: (id: string) => void;
}) {
  return (
      <section className="management-history-panel work-panel">
        <header className="management-panel-heading">
          <div><span className="module-kicker">Guardado en este navegador</span><h3>Informes del período</h3></div>
          <span className="management-context-id">{records.length} registros</span>
        </header>
        <div className="management-history-table-wrap">
          <table className="management-history-table">
            <thead>
              <tr><th>Año</th><th>Expediente</th><th>Estado</th><th>Validó</th><th>Aprobó</th><th>Fecha de cierre</th><th>Archivo</th></tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const validation = record.approvals[0];
                const approval = record.approvals[1];
                return (
                  <tr key={record.id}>
                    <td><strong className="history-year">{record.period.year}</strong></td>
                    <td><code>{record.id}</code><small>Rev. {record.revision} · {formatDate(record.generatedAt)}</small></td>
                    <td><span className={`management-review-status status-${record.status}`}>{reviewStatusLabels[record.status]}</span></td>
                    <td><strong>{validation.approverName ?? "Pendiente"}</strong><small>{validation.approverPosition ?? validation.requiredPosition}</small></td>
                    <td><strong>{approval.approverName ?? "Pendiente"}</strong><small>{approval.approverPosition ?? approval.requiredPosition}</small></td>
                    <td>{approval.approvedAt ? formatDate(approval.approvedAt) : "Pendiente"}</td>
                    <td><button className="button button-secondary history-open-button" type="button" onClick={() => onOpen(record.id)}><Eye size={15} />Ver acta</button></td>
                  </tr>
                );
              })}
              {!records.length ? <tr><td colSpan={7}>No hay informes guardados para este período en este navegador.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

  );
}

function ClosedAuthorizationPanel({ record }: { record: ManagementReviewRecord }) {
  return (
    <section className="management-closed-approvals work-panel print-hidden">
      <header className="management-panel-heading">
        <div><span className="module-kicker">Expediente cerrado</span><h3>Autorizaciones registradas</h3></div>
        <span className="management-separation"><LockKeyhole size={14} />Acta bloqueada</span>
      </header>
      <div className="management-signature-grid">
        {record.approvals.map((approval, index) => (
          <article key={approval.stage}>
            <span className="management-signature-check"><CheckCircle2 size={18} /></span>
            <div>
              <small>{index === 0 ? "Validó" : "Aprobó"}</small>
              <strong>{approval.approverName}</strong>
              <span>{approval.approverPosition}</span>
              <time>{formatDateTime(approval.approvedAt ?? "")}</time>
              {approval.comment ? <p>{approval.comment}</p> : null}
            </div>
          </article>
        ))}
      </div>
      <footer className="management-finalized"><CheckCircle2 size={19} /><div><strong>Revisión cerrada</strong><span>El archivo conserva las autorizaciones y ya no admite cambios.</span></div></footer>
    </section>
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
