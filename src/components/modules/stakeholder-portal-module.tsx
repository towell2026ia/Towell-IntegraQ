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
  activeCertifications,
  externalAuditCalendar,
} from "@/lib/quality-parties-data";
import type { CorrectiveAction } from "@/lib/types";

type PortalKind = "customer" | "supplier";

export function StakeholderPortalModule({ kind, actions }: { kind: PortalKind; actions: CorrectiveAction[] }) {
  return kind === "customer" ? <CustomerPortal actions={actions} /> : <SupplierPortal />;
}

function CustomerPortal({ actions }: { actions: CorrectiveAction[] }) {
  const [view, setView] = useState<"actions" | "audits" | "certifications">("actions");
  const [selectedActionId, setSelectedActionId] = useState("");
  const accountName = "Cliente corporativo A";
  const customerActions = actions.filter(
    (action) =>
      action.source === "customer" &&
      (!action.relatedParty || action.relatedParty === accountName),
  );
  const selectedAction = customerActions.find((action) => action.id === selectedActionId);
  return (
    <>
      <PortalHeading title="Portal del cliente" account={accountName} description="Reclamos, acciones, auditorías externas y certificaciones autorizadas." />
      <PortalIsolationNote party="cliente" />
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
          {customerActions.map((action) => (
            <article key={action.id}>
              <div><code>{action.folio}</code><h4>{action.title}</h4><p>{action.problem}</p><button className="button button-secondary portal-report-link" type="button" onClick={() => setSelectedActionId(action.id)}><FileText size={15} /> Ver reporte A3</button></div>
              <dl><div><dt>Avance</dt><dd>{action.progress}%</dd></div><div><dt>Vencimiento</dt><dd>{formatDate(action.dueDate)}</dd></div><div><dt>Planes</dt><dd>{action.a3?.plans.length ?? 0}</dd></div></dl>
              <span className="quality-state warning">{action.status}</span>
            </article>
          ))}
        </section>
      ) : null}
      {view === "audits" ? <PortalTable title="Calendario de auditorías externas"><table className="quality-table"><thead><tr><th>Evento</th><th>Fecha</th><th>Alcance</th><th>Estado</th></tr></thead><tbody>{externalAuditCalendar.map((audit) => <tr key={audit.id}><td><strong>{audit.id}</strong></td><td>{formatDate(audit.date)}</td><td>{audit.scope}</td><td><span className="quality-state success">{audit.status}</span></td></tr>)}</tbody></table></PortalTable> : null}
      {view === "certifications" ? <PortalTable title="Certificaciones y certificados vigentes"><table className="quality-table"><thead><tr><th>Certificación</th><th>Documento</th><th>Vigente hasta</th><th>Estado</th></tr></thead><tbody>{activeCertifications.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.certificate}</td><td>{formatDate(item.validUntil)}</td><td><span className="quality-state success">Vigente</span></td></tr>)}</tbody></table></PortalTable> : null}
    </>
  );
}

function SupplierPortal() {
  const [view, setView] = useState<"rncp" | "audits" | "plans">("rncp");
  const [submitted, setSubmitted] = useState(false);
  const [evidenceName, setEvidenceName] = useState("");
  const submitPlan = (event: FormEvent) => { event.preventDefault(); setSubmitted(true); };
  return (
    <>
      <PortalHeading title="Portal de proveedores" account="United Dragon" description="RNCP, auditorías, planes de acción, plazos y evidencias de la cuenta." />
      <PortalIsolationNote party="proveedor" />
      <section className="portal-deadline-band"><CalendarDays size={18} /><div><strong>Próximo compromiso: 14 ago 2026</strong><p>Quedan 4 días para responder el hallazgo RNCP0204.</p></div><span className="quality-state warning">En tiempo</span></section>
      <div className="quality-view-tabs portal-tabs" aria-label="Vistas del portal de proveedores">
        <button className={view === "rncp" ? "active" : ""} type="button" onClick={() => setView("rncp")}>Mis RNCP</button>
        <button className={view === "audits" ? "active" : ""} type="button" onClick={() => setView("audits")}>Mis auditorías</button>
        <button className={view === "plans" ? "active" : ""} type="button" onClick={() => setView("plans")}>Planes y evidencias</button>
      </div>
      {view === "rncp" ? (
        <section className="portal-record-list">
          <header><div><h3>Reportes de no calidad asignados</h3><p>Publicados desde Gestión de calidad de proveedores.</p></div><FileText size={19} /></header>
          <article><div><code>RNCP0204</code><h4>Hilo 20/2 con mayor torsión</h4><p>Materia prima: Hilo · Acción inmediata requerida.</p></div><dl><div><dt>Fecha</dt><dd>01 ago 2026</dd></div><div><dt>Plazo</dt><dd>14 ago 2026</dd></div><div><dt>Evidencias</dt><dd>0</dd></div></dl><span className="quality-state danger">En proceso</span></article>
        </section>
      ) : null}
      {view === "audits" ? (
        <section className="supplier-portal-audit"><header><div><h3>Resultado de auditoría</h3><p>Checklist procesado por Calidad de proveedores.</p></div><FileCheck2 size={19} /></header><div className="portal-score"><strong>87%</strong><span>Resultado global</span></div><div className="audit-result-summary"><div><small>Hallazgos</small><strong>3</strong></div><div><small>Conformes</small><strong>20</strong></div><div><small>No conformes</small><strong>3</strong></div><div><small>Estado</small><strong>Seguimiento</strong></div></div></section>
      ) : null}
      {view === "plans" ? (
        <section className="portal-action-form"><header><div><h3>Respuesta del proveedor</h3><p>Las acciones se capturan manualmente y las evidencias se anexan al mismo hallazgo.</p></div><ShieldCheck size={19} /></header><form onSubmit={submitPlan}><div className="rncp-form-grid"><label className="wide"><span>Acción propuesta</span><textarea rows={4} required placeholder="Describa la acción, responsable y alcance" /></label><label><span>Responsable</span><input required /></label><label><span>Fecha compromiso</span><input type="date" defaultValue="2026-08-14" required /></label><label className="wide evidence-upload"><span>Evidencia</span><span className="button button-secondary"><Upload size={16} /> {evidenceName || "Seleccionar archivo"}</span><input type="file" onChange={(event) => setEvidenceName(event.target.files?.[0]?.name ?? "")} /></label></div>{submitted ? <div className="form-success"><CheckCircle2 size={17} /> Respuesta registrada en esta vista; la notificación se activará con el servicio de datos.</div> : null}<div className="configuration-actions"><button className="button button-primary" type="submit"><Send size={16} /> Enviar respuesta</button></div></form></section>
      ) : null}
    </>
  );
}

function PortalHeading({ title, account, description }: { title: string; account: string; description: string }) {
  return <section className="module-heading portal-heading"><div><p className="module-kicker">Acceso externo</p><h2>{title}</h2><p>{description}</p></div><div className="portal-account"><UserRoundCheck size={18} /><span><small>Cuenta activa</small><strong>{account}</strong></span></div></section>;
}

function PortalIsolationNote({ party }: { party: "cliente" | "proveedor" }) {
  return <section className="portal-isolation-note"><LockKeyhole size={19} /><div><strong>Acceso aislado por cuenta</strong><p>Esta sesión solo puede consultar información vinculada con este {party}. No existe acceso a expedientes de otras cuentas.</p></div></section>;
}

function PortalTable({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="quality-table-panel"><header><div><h3>{title}</h3><p>Contenido autorizado para esta cuenta.</p></div><FileCheck2 size={19} /></header><div className="quality-table-wrap">{children}</div></section>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
