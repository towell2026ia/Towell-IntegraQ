"use client";

import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  LockKeyhole,
  Send,
  ShieldCheck,
  Upload,
  UserRoundCheck,
} from "lucide-react";
import { FormEvent, useState } from "react";

import { A3ActionReport } from "@/components/modules/a3-action-report";
import {
  getCustomerPortalData,
  getSupplierPortalData,
  resolvePortalCompany,
} from "@/lib/portal-access";
import type { ActiveSession } from "@/lib/session-data";
import type { CorrectiveAction } from "@/lib/types";

type PortalKind = "customer" | "supplier";

export function StakeholderPortalModule({
  kind,
  actions,
  session,
}: {
  kind: PortalKind;
  actions: CorrectiveAction[];
  session: ActiveSession;
}) {
  const company = resolvePortalCompany(session, kind);
  if (!company) return <PortalAccessDenied />;
  return kind === "customer" ? (
    <CustomerPortal actions={actions} company={company} />
  ) : (
    <SupplierPortal company={company} />
  );
}

function CustomerPortal({
  actions,
  company,
}: {
  actions: CorrectiveAction[];
  company: { companyId: string; companyName: string };
}) {
  const [view, setView] = useState<"actions" | "audits" | "certifications">("actions");
  const [selectedActionId, setSelectedActionId] = useState("");
  const portalData = getCustomerPortalData(company.companyId, actions);
  const selectedAction = portalData.actions.find((action) => action.id === selectedActionId);
  return (
    <>
      <PortalHeading title="Portal del cliente" account={company.companyName} description="Reclamos, acciones, auditorías externas y certificaciones autorizadas." />
      <div className="quality-view-tabs portal-tabs" aria-label="Vistas del portal del cliente">
        <button className={view === "actions" ? "active" : ""} type="button" onClick={() => setView("actions")}>Mis reclamos y acciones</button>
        <button className={view === "audits" ? "active" : ""} type="button" onClick={() => setView("audits")}>Auditorías externas</button>
        <button className={view === "certifications" ? "active" : ""} type="button" onClick={() => setView("certifications")}>Certificaciones</button>
      </div>
      {view === "actions" ? (
        selectedAction ? (
          <A3ActionReport action={selectedAction} onBack={() => setSelectedActionId("")} />
        ) : <section className="portal-record-list">
          <header><div><h3>Mis reclamos, hallazgos y planes</h3><p>Vista de consulta compartida desde Root2Cause; no permite editar el análisis A3.</p></div><ClipboardCheck size={19} /></header>
          {portalData.actions.map((action) => (
            <article key={action.id}>
              <div><code>{action.folio}</code><h4>{action.title}</h4><p>{action.problem}</p><button className="button button-secondary portal-report-link" type="button" onClick={() => setSelectedActionId(action.id)}><FileText size={15} /> Ver reporte A3</button></div>
              <dl><div><dt>Avance</dt><dd>{action.progress}%</dd></div><div><dt>Vencimiento</dt><dd>{formatDate(action.dueDate)}</dd></div><div><dt>Planes</dt><dd>{action.a3?.plans.length ?? 0}</dd></div></dl>
              <span className="quality-state warning">{action.status}</span>
            </article>
          ))}
          {portalData.actions.length === 0 ? <PortalEmpty message="No hay reclamos ni acciones compartidas con esta empresa." /> : null}
        </section>
      ) : null}
      {view === "audits" ? <PortalTable title="Calendario de auditorías externas"><table className="quality-table"><thead><tr><th>Evento</th><th>Fecha</th><th>Alcance</th><th>Estado</th></tr></thead><tbody>{portalData.audits.map((audit) => <tr key={audit.id}><td><strong>{audit.id}</strong></td><td>{formatDate(audit.date)}</td><td>{audit.scope}</td><td><span className="quality-state success">{audit.status}</span></td></tr>)}</tbody></table>{portalData.audits.length === 0 ? <PortalEmpty message="No hay auditorías compartidas con esta empresa." /> : null}</PortalTable> : null}
      {view === "certifications" ? <PortalTable title="Certificaciones y certificados vigentes"><table className="quality-table"><thead><tr><th>Certificación</th><th>Documento</th><th>Vigente hasta</th><th>Estado</th></tr></thead><tbody>{portalData.certifications.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.certificate}</td><td>{formatDate(item.validUntil)}</td><td><span className="quality-state success">Vigente</span></td></tr>)}</tbody></table>{portalData.certifications.length === 0 ? <PortalEmpty message="No hay certificados compartidos con esta empresa." /> : null}</PortalTable> : null}
    </>
  );
}

function SupplierPortal({ company }: { company: { companyId: string; companyName: string } }) {
  const [view, setView] = useState<"rncp" | "audits" | "plans">("rncp");
  const [submitted, setSubmitted] = useState(false);
  const [evidenceName, setEvidenceName] = useState("");
  const portalData = getSupplierPortalData(company.companyId);
  const nextPlan = portalData.plans[0];
  const auditResult = portalData.audits[0];
  const submitPlan = (event: FormEvent) => { event.preventDefault(); setSubmitted(true); };
  return (
    <>
      <PortalHeading title="Portal de proveedores" account={company.companyName} description="RNCP, auditorías, planes de acción, plazos y evidencias de la cuenta." />
      {nextPlan ? <section className="portal-deadline-band"><CalendarDays size={18} /><div><strong>Próximo compromiso: {formatDate(nextPlan.dueDate)}</strong><p>Respuesta pendiente para el hallazgo {nextPlan.rncpId}.</p></div><span className="quality-state warning">{nextPlan.status}</span></section> : null}
      <div className="quality-view-tabs portal-tabs" aria-label="Vistas del portal de proveedores">
        <button className={view === "rncp" ? "active" : ""} type="button" onClick={() => setView("rncp")}>Mis RNCP</button>
        <button className={view === "audits" ? "active" : ""} type="button" onClick={() => setView("audits")}>Mis auditorías</button>
        <button className={view === "plans" ? "active" : ""} type="button" onClick={() => setView("plans")}>Planes y evidencias</button>
      </div>
      {view === "rncp" ? (
        <section className="portal-record-list">
          <header><div><h3>Reportes de no calidad asignados</h3><p>Publicados desde Gestión de calidad de proveedores.</p></div><FileText size={19} /></header>
          {portalData.rncp.map((record) => <article key={record.id}><div><code>{record.id}</code><h4>{record.title}</h4><p>Materia prima: {record.material} · Acción inmediata requerida.</p></div><dl><div><dt>Fecha</dt><dd>{formatDate(record.date)}</dd></div><div><dt>Plazo</dt><dd>{formatDate(record.dueDate)}</dd></div><div><dt>Evidencias</dt><dd>{record.evidenceCount}</dd></div></dl><span className="quality-state danger">{record.status}</span></article>)}
          {portalData.rncp.length === 0 ? <PortalEmpty message="No hay reportes de no calidad asignados a esta empresa." /> : null}
        </section>
      ) : null}
      {view === "audits" ? (
        <section className="supplier-portal-audit"><header><div><h3>Resultado de auditoría</h3><p>Checklist procesado por Calidad de proveedores.</p></div><FileCheck2 size={19} /></header>{auditResult ? <><div className="portal-score"><strong>{auditResult.score}%</strong><span>Resultado global</span></div><div className="audit-result-summary"><div><small>Hallazgos</small><strong>{auditResult.findings}</strong></div><div><small>Conformes</small><strong>{auditResult.compliant}</strong></div><div><small>No conformes</small><strong>{auditResult.nonCompliant}</strong></div><div><small>Estado</small><strong>{auditResult.status}</strong></div></div></> : <PortalEmpty message="No hay resultados de auditoría autorizados para esta empresa." />}</section>
      ) : null}
      {view === "plans" ? (
        <section className="portal-action-form"><header><div><h3>Respuesta del proveedor</h3><p>Las acciones se capturan manualmente y las evidencias se anexan al mismo hallazgo.</p></div><ShieldCheck size={19} /></header>{nextPlan ? <form onSubmit={submitPlan}><div className="rncp-form-grid"><label className="wide"><span>Acción propuesta</span><textarea rows={4} required placeholder="Describa la acción, responsable y alcance" /></label><label><span>Responsable</span><input required /></label><label><span>Fecha compromiso</span><input type="date" defaultValue={nextPlan.dueDate} required /></label><label className="wide evidence-upload"><span>Evidencia</span><span className="button button-secondary"><Upload size={16} /> {evidenceName || "Seleccionar archivo"}</span><input type="file" onChange={(event) => setEvidenceName(event.target.files?.[0]?.name ?? "")} /></label></div>{submitted ? <div className="form-success"><CheckCircle2 size={17} /> Respuesta registrada en esta vista; la notificación se activará con el servicio de datos.</div> : null}<div className="configuration-actions"><button className="button button-primary" type="submit"><Send size={16} /> Enviar respuesta</button></div></form> : <PortalEmpty message="No hay planes de acción asignados a esta empresa." />}</section>
      ) : null}
    </>
  );
}

function PortalHeading({ title, account, description }: { title: string; account: string; description: string }) {
  return <section className="module-heading portal-heading"><div><p className="module-kicker">Acceso externo</p><h2>{title}</h2><p>{description}</p></div><div className="portal-account"><UserRoundCheck size={18} /><span><small>Cuenta activa</small><strong>{account}</strong></span></div></section>;
}

function PortalTable({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="quality-table-panel"><header><div><h3>{title}</h3><p>Contenido autorizado para esta cuenta.</p></div><FileCheck2 size={19} /></header><div className="quality-table-wrap">{children}</div></section>;
}

function PortalEmpty({ message }: { message: string }) {
  return <div className="access-empty portal-empty"><LockKeyhole size={22} /><p>{message}</p></div>;
}

function PortalAccessDenied() {
  return <section className="access-empty portal-access-denied"><LockKeyhole size={28} /><h2>Acceso no disponible</h2><p>La sesión no tiene una empresa válida vinculada para este portal.</p></section>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
