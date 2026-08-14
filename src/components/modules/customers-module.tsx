"use client";

import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Link2,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import {
  activeCertifications,
  customerQualityCatalog,
  externalAuditCalendar,
  type CustomerQualityRecord,
} from "@/lib/quality-parties-data";
import type { CorrectiveAction } from "@/lib/types";

type CustomerView = "customers" | "cases" | "audits" | "certifications";

export function CustomersModule({ actions }: { actions: CorrectiveAction[] }) {
  const [view, setView] = useState<CustomerView>("customers");
  const [customers, setCustomers] = useState(customerQualityCatalog);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(customerQualityCatalog[0].id);
  const [isCreateOpen, setCreateOpen] = useState(false);

  const filteredCustomers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return customers.filter(
      (customer) =>
        !normalized ||
        [customer.code, customer.name].some((value) =>
          value.toLocaleLowerCase("es").includes(normalized),
        ),
    );
  }, [customers, query]);

  const selected =
    filteredCustomers.find((customer) => customer.id === selectedId) ??
    filteredCustomers[0] ??
    customers[0];
  const customerActions = actions.filter((action) => action.source === "customer");

  const addCustomer = (customer: Pick<CustomerQualityRecord, "code" | "name">) => {
    const record: CustomerQualityRecord = {
      ...customer,
      id: crypto.randomUUID(),
      claims: 0,
      findings: 0,
      openActions: 0,
      nextExternalAudit: "Sin programar",
      certificates: 0,
    };
    setCustomers((current) => [record, ...current]);
    setSelectedId(record.id);
    setCreateOpen(false);
  };

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Gestión interna</p>
          <h2>Gestión de calidad de clientes</h2>
          <p>Expedientes de cliente conectados con reclamos y acciones de Root2Cause.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={17} /> Agregar cliente
        </button>
      </section>

      <section className="metric-grid" aria-label="Resumen de clientes">
        <QualityMetric icon={<Users size={18} />} label="Clientes registrados" value={customers.length} tone="neutral" />
        <QualityMetric icon={<ClipboardCheck size={18} />} label="Reclamos y hallazgos" value={customers.reduce((total, item) => total + item.claims + item.findings, 0)} tone="danger" />
        <QualityMetric icon={<CheckCircle2 size={18} />} label="Acciones abiertas" value={customers.reduce((total, item) => total + item.openActions, 0)} tone="warning" />
        <QualityMetric icon={<CalendarDays size={18} />} label="Auditorías programadas" value={externalAuditCalendar.length} tone="success" />
      </section>

      <section className="quality-source-note">
        <Link2 size={18} />
        <div>
          <strong>Fuente única: Root2Cause</strong>
          <p>Reclamos, acciones correctivas y planes de acción se registran una vez. El portal filtra únicamente los registros de la cuenta cliente autenticada.</p>
        </div>
        <span>Aislamiento por cliente</span>
      </section>

      <div className="quality-view-tabs" aria-label="Vistas de calidad de clientes">
        <button className={view === "customers" ? "active" : ""} type="button" onClick={() => setView("customers")}>Clientes</button>
        <button className={view === "cases" ? "active" : ""} type="button" onClick={() => setView("cases")}>Reclamos y hallazgos</button>
        <button className={view === "audits" ? "active" : ""} type="button" onClick={() => setView("audits")}>Auditorías externas</button>
        <button className={view === "certifications" ? "active" : ""} type="button" onClick={() => setView("certifications")}>Certificaciones</button>
      </div>

      {view === "customers" ? (
        <section className="party-directory-layout">
          <div className="party-list-panel">
            <label className="panel-search party-search">
              <Search size={16} />
              <input aria-label="Buscar cliente" placeholder="Código o cliente" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="configuration-count">{filteredCustomers.length} clientes</div>
            <div className="party-list">
              {filteredCustomers.map((customer) => (
                <button className={customer.id === selected.id ? "selected" : ""} key={customer.id} type="button" onClick={() => setSelectedId(customer.id)}>
                  <span><strong>{customer.name}</strong><small>{customer.code}</small></span>
                  <span className={customer.openActions > 0 ? "quality-state warning" : "quality-state success"}>
                    {customer.openActions > 0 ? `${customer.openActions} abiertas` : "Sin pendientes"}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="party-detail-panel">
            <header>
              <span className="detail-eyebrow"><Users size={14} /> {selected.code}</span>
              <h3>{selected.name}</h3>
              <p>Expediente interno y contenido autorizado para su portal.</p>
            </header>
            <div className="party-detail-facts">
              <div><small>Reclamos</small><strong>{selected.claims}</strong></div>
              <div><small>Hallazgos</small><strong>{selected.findings}</strong></div>
              <div><small>Acciones abiertas</small><strong>{selected.openActions}</strong></div>
              <div><small>Certificados</small><strong>{selected.certificates}</strong></div>
            </div>
            <section className="party-detail-section">
              <div className="section-title-row"><h4>Acceso del cliente</h4><span className="quality-state success">Cuenta aislada</span></div>
              <div className="account-scope-list">
                <div><ShieldCheck size={17} /><span><strong>Solo información propia</strong><small>Ningún cliente puede consultar expedientes de otra cuenta.</small></span></div>
                <div><ClipboardCheck size={17} /><span><strong>Acciones desde Root2Cause</strong><small>Se muestran reclamos, acciones correctivas y planes vinculados.</small></span></div>
                <div><CalendarDays size={17} /><span><strong>Próxima auditoría externa</strong><small>{formatDate(selected.nextExternalAudit)}</small></span></div>
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {view === "cases" ? (
        <QualityTablePanel title="Reclamos, hallazgos y acciones" subtitle="Datos compartidos desde Root2Cause">
          <table className="quality-table">
            <thead><tr><th>Folio</th><th>Asunto</th><th>Estado</th><th>Avance</th><th>Vencimiento</th></tr></thead>
            <tbody>
              {customerActions.map((action) => (
                <tr key={action.id}><td><code>{action.folio}</code></td><td><strong>{action.title}</strong></td><td>{action.status}</td><td>{action.progress}%</td><td>{formatDate(action.dueDate)}</td></tr>
              ))}
            </tbody>
          </table>
        </QualityTablePanel>
      ) : null}

      {view === "audits" ? (
        <QualityTablePanel title="Calendario de auditorías externas" subtitle="Vista autorizada también para clientes">
          <table className="quality-table">
            <thead><tr><th>Evento</th><th>Cliente u organismo</th><th>Fecha</th><th>Alcance</th><th>Estado</th></tr></thead>
            <tbody>{externalAuditCalendar.map((audit) => <tr key={audit.id}><td><code>{audit.id}</code></td><td><strong>{audit.party}</strong></td><td>{formatDate(audit.date)}</td><td>{audit.scope}</td><td><span className="quality-state success">{audit.status}</span></td></tr>)}</tbody>
          </table>
        </QualityTablePanel>
      ) : null}

      {view === "certifications" ? (
        <QualityTablePanel title="Certificaciones y certificados vigentes" subtitle="Solo se publican documentos vigentes">
          <table className="quality-table">
            <thead><tr><th>Certificación</th><th>Documento</th><th>Vigente hasta</th><th>Estado</th></tr></thead>
            <tbody>{activeCertifications.map((certification) => <tr key={certification.name}><td><strong>{certification.name}</strong></td><td>{certification.certificate}</td><td>{formatDate(certification.validUntil)}</td><td><span className="quality-state success">Vigente</span></td></tr>)}</tbody>
          </table>
        </QualityTablePanel>
      ) : null}

      {isCreateOpen ? <CreateCustomerModal onClose={() => setCreateOpen(false)} onCreate={addCustomer} /> : null}
    </>
  );
}

function QualityMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "neutral" | "success" | "warning" | "danger" }) {
  return <div className={`metric metric-${tone}`}><span className="metric-icon">{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div>;
}

function QualityTablePanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="quality-table-panel"><header><div><h3>{title}</h3><p>{subtitle}</p></div><FileCheck2 size={19} /></header><div className="quality-table-wrap">{children}</div></section>;
}

function CreateCustomerModal({ onClose, onCreate }: { onClose: () => void; onCreate: (customer: Pick<CustomerQualityRecord, "code" | "name">) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() && name.trim()) onCreate({ code: code.trim(), name: name.trim() });
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal-compact" role="dialog" aria-modal="true" aria-labelledby="new-customer-title">
        <div className="modal-header"><div><p className="module-kicker">Directorio</p><h3 id="new-customer-title">Agregar cliente</h3></div><button className="icon-button" type="button" title="Cerrar" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit}>
          <div className="form-grid single-column">
            <label><span>Código</span><input required value={code} onChange={(event) => setCode(event.target.value)} placeholder="CLI-004" /></label>
            <label><span>Nombre del cliente</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          </div>
          <div className="modal-footer"><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit">Agregar cliente</button></div>
        </form>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
