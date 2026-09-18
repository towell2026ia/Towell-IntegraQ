"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarRange,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  History,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  auditDateLabel,
  auditOccupiesDate,
  auditOriginLabels,
  auditPeriodOptions,
  auditPeriodicLabel,
  auditOccursInPeriod,
  auditScheduleBounds,
  auditStandardOptions,
  auditStatusLabels,
  auditTypeLabels,
  auditTypeOptions,
  createAuditOccurrence,
  emptyAuditDraft,
  findPossibleDuplicates,
  normalizeAuditRules,
  validateAuditDraft,
  type AuditDraft,
  type AuditOccurrence,
  type AuditStatus,
} from "@/lib/audit-data";
import { processCatalog } from "@/lib/configuration-data";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { customerQualityCatalog } from "@/lib/quality-parties-data";
import type { ActiveSession } from "@/lib/session-data";

type AuditView = "calendar" | "registry" | "create" | "success";
type CalendarMonth = { year: number; month: number };

const customers = [
  { id: "walmart", name: "Walmart" },
  { id: "target", name: "Target" },
  { id: "costco", name: "Costco" },
  { id: "amazon", name: "Amazon" },
  { id: "liverpool", name: "Liverpool" },
  ...customerQualityCatalog.map((customer) => ({ id: customer.id, name: customer.name })),
];

const auditUsers = [
  { id: "team-quality", name: "Coordinación de Calidad" },
  { id: "team-production", name: "Responsable de Producción" },
  { id: "team-hr", name: "Responsable de Recursos Humanos" },
  { id: "team-maintenance", name: "Responsable de Mantenimiento" },
  { id: "team-safety", name: "Responsable de Seguridad" },
];

export function AuditsModule({
  occurrences,
  onOccurrencesChange,
  session,
}: {
  occurrences: AuditOccurrence[];
  onOccurrencesChange: (occurrences: AuditOccurrence[]) => void;
  session: ActiveSession;
}) {
  const [view, setView] = useState<AuditView>("calendar");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AuditStatus | "all">("all");
  const [created, setCreated] = useState<AuditOccurrence | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<CalendarMonth>(() => initialAuditMonth(occurrences));
  const [selectedAudit, setSelectedAudit] = useState<AuditOccurrence | null>(null);
  const canCreate = canPerformModuleAction(session, "audits", "manage") || canPerformModuleAction(session, "audits", "create");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return occurrences.filter((audit) => {
      const matchesStatus = statusFilter === "all" || audit.status === statusFilter;
      const matchesText = !normalized || [audit.code, audit.title, audit.customerName, audit.organizationName, audit.responsibleName]
        .some((value) => value.toLocaleLowerCase("es").includes(normalized));
      return matchesStatus && matchesText;
    });
  }, [occurrences, query, statusFilter]);

  const beginCreate = () => {
    setCreated(null);
    setView("create");
  };

  const save = (draft: AuditDraft, confirmed: boolean) => {
    const occurrence = createAuditOccurrence(draft, occurrences, session.name, confirmed);
    onOccurrencesChange([occurrence, ...occurrences]);
    setCreated(occurrence);
    setView(confirmed ? "success" : "registry");
  };

  if (view === "create") {
    return <AuditCreateForm existing={occurrences} onCancel={() => setView("calendar")} onSave={save} session={session} />;
  }

  if (view === "success" && created) {
    return (
      <AuditSuccess
        audit={created}
        onCreateAnother={beginCreate}
        onCalendar={() => { focusAuditInCalendar(created, setCalendarMonth, setSelectedAudit); setStatusFilter("all"); setView("calendar"); }}
        onView={() => { setQuery(created.code); setStatusFilter("all"); setView("registry"); }}
      />
    );
  }

  const scheduled = occurrences.filter((audit) => audit.status === "scheduled" || audit.status === "window_open").length;
  const pending = occurrences.filter((audit) => audit.status === "pending_schedule").length;
  const drafts = occurrences.filter((audit) => audit.status === "draft").length;

  return (
    <div className="audit-module">
      <section className="module-heading audit-heading">
        <div>
          <p className="module-kicker">Operación · programación y control</p>
          <h2>Auditorías</h2>
          <p>Visualiza fechas confirmadas, rangos y ventanas de auditoría en el calendario.</p>
        </div>
        {canCreate ? <button className="button button-primary" type="button" onClick={beginCreate}><Plus size={17} /> Nueva auditoría</button> : null}
      </section>

      <section className="audit-metrics" aria-label="Resumen de auditorías">
        <AuditMetric icon={<ShieldCheck size={19} />} label="Ocurrencias" value={occurrences.length} tone="blue" />
        <AuditMetric icon={<CalendarDays size={19} />} label="Programadas" value={scheduled} tone="green" />
        <AuditMetric icon={<Clock3 size={19} />} label="Por programar" value={pending} tone="amber" />
        <AuditMetric icon={<FileText size={19} />} label="Borradores" value={drafts} tone="neutral" />
      </section>

      <section className="audit-register-panel audit-workspace-panel">
        <header className="audit-register-toolbar">
          <div>
            <div className="audit-view-switch" aria-label="Vista de auditorías">
              <button aria-pressed={view === "calendar"} className={view === "calendar" ? "active" : ""} type="button" onClick={() => setView("calendar")}><CalendarDays size={15} /> Calendario</button>
              <button aria-pressed={view === "registry"} className={view === "registry" ? "active" : ""} type="button" onClick={() => setView("registry")}><FileText size={15} /> Registro</button>
            </div>
            <p>{view === "calendar" ? "Las franjas muestran la duración real de cada ventana." : "El histórico permanece intacto; cada revisión genera un folio nuevo."}</p>
          </div>
          <div className="audit-register-filters">
            <label className="panel-search"><Search size={16} /><input aria-label="Buscar auditoría" placeholder="Folio, nombre o entidad" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AuditStatus | "all")}>
              <option value="all">Todos los estados</option>
              {Object.entries(auditStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </header>
        {view === "calendar" ? (
          <AuditCalendar
            audits={filtered}
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            onSelect={setSelectedAudit}
            selected={selectedAudit}
          />
        ) : <AuditRegistry audits={filtered} />}
      </section>
    </div>
  );
}

function AuditRegistry({ audits }: { audits: AuditOccurrence[] }) {
  return (
    <div className="audit-table-wrap">
      <table className="audit-table">
        <thead><tr><th>Auditoría</th><th>Tipo y origen</th><th>Entidad</th><th>Programación</th><th>Responsable</th><th>Estado</th></tr></thead>
        <tbody>
          {audits.map((audit) => (
            <tr key={audit.id}>
              <td><code>{audit.code}</code><strong>{audit.title || "Borrador sin nombre"}</strong><small>{audit.processIds.length} procesos · {audit.standards.join(", ") || "Sin norma"}</small></td>
              <td><strong>{audit.auditType ? auditTypeLabels[audit.auditType] : "Por definir"}</strong><small>{audit.origin ? auditOriginLabels[audit.origin] : "Origen pendiente"}</small></td>
              <td><strong>{audit.customerName || audit.organizationName || (audit.entityKind === "internal" ? "Interna" : "Por definir")}</strong><small>{audit.contactName || "Sin contacto externo"}</small></td>
              <td><strong>{auditDateLabel(audit)}</strong><small>{audit.scheduleType === "window" ? "Ventana de auditoría" : audit.scheduleType === "periodic" ? "Auditoría periódica" : audit.scheduleType === "pending" ? "Fecha pendiente" : "Fecha confirmada"}</small></td>
              <td><strong>{audit.responsibleName || "Por asignar"}</strong><small>{audit.participantNames.length} participantes</small></td>
              <td><span className={`audit-status audit-status-${audit.status}`}>{auditStatusLabels[audit.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!audits.length ? <div className="audit-empty"><Search size={22} /><strong>No encontramos auditorías</strong><span>Prueba con otro término o estado.</span></div> : null}
    </div>
  );
}

function AuditCalendar({
  audits,
  month,
  onMonthChange,
  onSelect,
  selected,
}: {
  audits: AuditOccurrence[];
  month: CalendarMonth;
  onMonthChange: (month: CalendarMonth) => void;
  onSelect: (audit: AuditOccurrence | null) => void;
  selected: AuditOccurrence | null;
}) {
  const cells = getCalendarCells(month.year, month.month);
  const windows = audits.filter((audit) => audit.scheduleType === "window" && audit.windowStart && audit.windowEnd);
  const pending = audits.filter((audit) => audit.scheduleType === "pending");
  const rawMonthTitle = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(month.year, month.month, 1)));
  const monthTitle = rawMonthTitle.charAt(0).toLocaleUpperCase("es") + rawMonthTitle.slice(1);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="audit-calendar-layout">
      <div className="audit-calendar-main">
        <header className="audit-calendar-header">
          <div><span><CalendarRange size={19} /></span><div><small>Programación general</small><h3>{monthTitle}</h3></div></div>
          <div className="audit-calendar-navigation">
            <button aria-label="Mes anterior" className="icon-button" title="Mes anterior" type="button" onClick={() => onMonthChange(shiftCalendarMonth(month, -1))}><ChevronLeft size={18} /></button>
            <button type="button" onClick={() => onMonthChange(todayCalendarMonth())}>Hoy</button>
            <button aria-label="Mes siguiente" className="icon-button" title="Mes siguiente" type="button" onClick={() => onMonthChange(shiftCalendarMonth(month, 1))}><ChevronRight size={18} /></button>
          </div>
        </header>
        <div className="audit-calendar-legend" aria-label="Leyenda del calendario">
          <span><i className="window" /> Ventana de auditoría</span>
          <span><i className="periodic" /> Auditoría periódica</span>
          <span><i className="exact" /> Fecha exacta</span>
        </div>
        <div className="audit-calendar-weekdays" aria-hidden="true">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="audit-calendar-grid">
          {cells.map((cell, index) => {
            if (!cell) return <div className="audit-calendar-day is-empty" key={`empty-${index}`} />;
            const dayAudits = audits.filter((audit) => {
              if (audit.scheduleType === "window" || audit.scheduleType === "pending") return false;
              if (audit.scheduleType === "periodic") return cell.day === 1 && auditOccursInPeriod(audit, cell.iso.slice(0, 7));
              return auditOccupiesDate(audit, cell.iso);
            });
            const dayWindows = windows.filter((audit) => auditOccupiesDate(audit, cell.iso));
            return (
              <div className={`audit-calendar-day${cell.iso === today ? " is-today" : ""}${dayWindows.length ? " has-window" : ""}`} key={cell.iso}>
                <time dateTime={cell.iso}>{cell.day}</time>
                <div className="audit-calendar-day-content">
                  {dayWindows.slice(0, 2).map((audit) => {
                    const [start, end] = auditScheduleBounds(audit);
                    const showLabel = cell.iso === start || cell.day === 1;
                    return (
                      <button
                        aria-label={`${audit.code}, ventana ${auditDateLabel(audit)}`}
                        className={`audit-calendar-window${cell.iso === start ? " starts" : ""}${cell.iso === end ? " ends" : ""}${selected?.id === audit.id ? " selected" : ""}`}
                        key={audit.id}
                        title={`${audit.code} · ${audit.title}`}
                        type="button"
                        onClick={() => onSelect(audit)}
                      >
                        {showLabel ? <span>{audit.code} · {audit.title}</span> : <span aria-hidden="true">&nbsp;</span>}
                      </button>
                    );
                  })}
                  {dayAudits.slice(0, 2).map((audit) => (
                    <button className={`audit-calendar-event event-${audit.scheduleType}${selected?.id === audit.id ? " selected" : ""}`} key={audit.id} title={`${audit.code} · ${audit.title}`} type="button" onClick={() => onSelect(audit)}>
                      <strong>{audit.code}</strong><span>{audit.title}</span>
                    </button>
                  ))}
                  {dayWindows.length + dayAudits.length > 2 ? <small className="audit-calendar-more">+{dayWindows.length + dayAudits.length - 2}</small> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="audit-calendar-sidebar">
        <section className="audit-window-list">
          <header><span><CalendarRange size={17} /></span><div><small>Periodos flexibles</small><h3>Ventanas de auditoría</h3></div><strong>{windows.length}</strong></header>
          <div>
            {windows.map((audit) => (
              <button className={selected?.id === audit.id ? "selected" : ""} key={audit.id} type="button" onClick={() => focusAuditInCalendar(audit, onMonthChange, onSelect)}>
                <span className="audit-window-color" />
                <span><code>{audit.code}</code><strong>{audit.title}</strong><small>{auditDateLabel(audit)}</small></span>
                <ChevronRight size={15} />
              </button>
            ))}
            {!windows.length ? <p className="audit-calendar-sidebar-empty">No hay ventanas con estos filtros.</p> : null}
          </div>
        </section>

        {selected ? <AuditCalendarDetail audit={selected} onClose={() => onSelect(null)} /> : null}

        {pending.length ? <section className="audit-calendar-pending"><header><Clock3 size={16} /><strong>Por programar</strong><span>{pending.length}</span></header>{pending.slice(0, 4).map((audit) => <button key={audit.id} type="button" onClick={() => onSelect(audit)}><code>{audit.code}</code><span>{audit.title || "Borrador sin nombre"}</span></button>)}</section> : null}
      </aside>
    </div>
  );
}

function AuditCalendarDetail({ audit, onClose }: { audit: AuditOccurrence; onClose: () => void }) {
  return (
    <section className="audit-calendar-detail">
      <header><span>Detalle seleccionado</span><button aria-label="Cerrar detalle" title="Cerrar" type="button" onClick={onClose}><X size={15} /></button></header>
      <code>{audit.code}</code>
      <h4>{audit.title || "Borrador sin nombre"}</h4>
      <p>{auditDateLabel(audit)}</p>
      <dl>
        <div><dt>Entidad</dt><dd>{audit.customerName || audit.organizationName || (audit.entityKind === "internal" ? "Interna" : "Por definir")}</dd></div>
        <div><dt>Responsable</dt><dd>{audit.responsibleName || "Por asignar"}</dd></div>
      </dl>
      <span className={`audit-status audit-status-${audit.status}`}>{auditStatusLabels[audit.status]}</span>
    </section>
  );
}

function initialAuditMonth(audits: AuditOccurrence[]): CalendarMonth {
  const today = new Date().toISOString().slice(0, 10);
  const starts = audits.map((audit) => auditScheduleBounds(audit)[0]).filter(Boolean).sort();
  const start = starts.find((date) => date >= today.slice(0, 8) + "01") ?? starts.at(-1);
  return start ? calendarMonthFromIso(start) : todayCalendarMonth();
}

function focusAuditInCalendar(audit: AuditOccurrence, setMonth: (month: CalendarMonth) => void, select: (audit: AuditOccurrence | null) => void) {
  const [start] = auditScheduleBounds(audit);
  if (start) setMonth(calendarMonthFromIso(start));
  select(audit);
}

function calendarMonthFromIso(date: string): CalendarMonth {
  const [year, month] = date.split("-").map(Number);
  return { year, month: month - 1 };
}

function todayCalendarMonth(): CalendarMonth {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function shiftCalendarMonth(value: CalendarMonth, offset: number): CalendarMonth {
  const date = new Date(Date.UTC(value.year, value.month + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

function getCalendarCells(year: number, month: number) {
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const totalDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > totalDays) return null;
    return { day, iso: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  });
}

function AuditCreateForm({
  existing,
  onCancel,
  onSave,
  session,
}: {
  existing: AuditOccurrence[];
  onCancel: () => void;
  onSave: (draft: AuditDraft, confirmed: boolean) => void;
  session: ActiveSession;
}) {
  const [draft, setDraft] = useState<AuditDraft>(emptyAuditDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<AuditOccurrence[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [activeSection, setActiveSection] = useState("identity");
  const allUsers = useMemo(() => [{ id: session.userId, name: session.name }, ...auditUsers.filter((user) => user.name !== session.name)], [session]);

  const update = <K extends keyof AuditDraft>(key: K, value: AuditDraft[K]) => {
    const next = normalizeAuditRules({ ...draft, [key]: value });
    setDraft(next);
    if (errors[key]) setErrors((current) => { const copy = { ...current }; delete copy[key]; return copy; });
  };

  const toggle = (key: "processIds" | "standards" | "participantIds", value: string) => {
    const current = draft[key];
    const selected = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    if (key === "participantIds") {
      const names = selected.map((id) => allUsers.find((user) => user.id === id)?.name).filter((name): name is string => Boolean(name));
      setDraft({ ...draft, participantIds: selected, participantNames: names });
    } else update(key, selected);
  };

  const saveDraft = () => onSave(draft, false);
  const confirm = (ignoreDuplicates = false) => {
    const normalized = normalizeAuditRules(draft);
    const validation = validateAuditDraft(normalized, true);
    setDraft(normalized);
    setErrors(validation);
    if (Object.keys(validation).length) {
      document.querySelector(".audit-form-error")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const matches = findPossibleDuplicates(normalized, existing);
    if (matches.length && !ignoreDuplicates) {
      setDuplicates(matches);
      setShowDuplicates(true);
      return;
    }
    onSave(normalized, true);
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const attachments = [...draft.attachments, ...Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      uploadedAt: new Date().toISOString(),
      uploadedBy: session.name,
      version: "1",
    }))];
    update("attachments", attachments);
  };

  const steps = [
    ["identity", "01", "Tipo y origen"],
    ["entity", "02", "Entidad relacionada"],
    ["scope", "03", "Alcance y normas"],
    ["schedule", "04", "Programación"],
    ["team", "05", "Responsables"],
    ["documents", "06", "Documentación"],
  ];

  return (
    <div className="audit-create-page">
      <section className="audit-create-heading">
        <button className="icon-button" type="button" title="Volver" onClick={onCancel}><ArrowLeft size={19} /></button>
        <div><p className="module-kicker">AUD-PRD-01</p><h2>Nueva auditoría</h2><p>Registra una ocurrencia real. Los campos con * son obligatorios al confirmar.</p></div>
        <span className="audit-draft-indicator"><span /> Borrador sin guardar</span>
      </section>

      <div className="audit-create-layout">
        <aside className="audit-stepper" aria-label="Secciones del formulario">
          {steps.map(([id, number, label]) => (
            <a className={activeSection === id ? "active" : ""} href={`#audit-${id}`} key={id} onClick={() => setActiveSection(id)}><span>{number}</span><strong>{label}</strong><ChevronRight size={15} /></a>
          ))}
          <div className="audit-stepper-note"><History size={17} /><span><strong>Histórico protegido</strong><small>Esta alta nunca sobrescribe ocurrencias anteriores.</small></span></div>
        </aside>

        <div className="audit-form-stack">
          {Object.keys(errors).length ? <div className="audit-form-error"><AlertTriangle size={18} /><div><strong>Falta información para crear la auditoría</strong><span>Revisa los campos marcados en rojo. Puedes guardarla como borrador si aún no tienes los datos.</span></div></div> : null}

          <AuditSection id="identity" number="01" title="Tipo, origen e información general" subtitle="Define qué auditoría es y cómo nace la ocurrencia.">
            <div className="audit-field wide"><span className="audit-label">Tipo de auditoría *</span><div className="audit-card-options audit-type-options">
              {auditTypeOptions.map(([value, label]) => <ChoiceCard key={value} checked={draft.auditType === value} label={label} onClick={() => update("auditType", value)} />)}
            </div>{errors.auditType ? <FieldError text={errors.auditType} /> : null}</div>
            <div className="audit-field wide"><span className="audit-label">¿Cómo se genera esta auditoría? *</span><div className="audit-card-options three">
              <ChoiceCard checked={draft.origin === "annual_plan"} label="Plan anual" description="Auditorías internas y de proceso" onClick={() => update("origin", "annual_plan")} />
              <ChoiceCard checked={draft.origin === "recurrence"} label="Programación / recurrencia" description="Seguimiento o revisión conocida" onClick={() => update("origin", "recurrence")} />
              <ChoiceCard checked={draft.origin === "notice"} disabled={draft.auditType === "customer"} label="Por aviso" description="Solo existe cuando un tercero avisa" onClick={() => update("origin", "notice")} />
            </div>{draft.auditType === "customer" ? <p className="audit-rule-note"><ShieldCheck size={15} /> Las auditorías de cliente siempre son por aviso y no generan recurrencia automática.</p> : null}{errors.origin ? <FieldError text={errors.origin} /> : null}</div>
            <Field label="Nombre de auditoría *" error={errors.title} wide><input value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="Ej. Auditoría Walmart FCCA 2026" /></Field>
            <Field label="Descripción" wide><textarea rows={3} value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="Contexto y propósito de la auditoría" /></Field>
          </AuditSection>

          <AuditSection id="entity" number="02" title="Entidad relacionada" subtitle="Identifica quién realiza o solicita la auditoría.">
            <div className="audit-field wide"><span className="audit-label">¿Quién realiza o solicita la auditoría? *</span><div className="audit-pill-options">
              {(["customer", "certifier", "auditor", "internal", "authority", "other"] as const).map((value) => {
                const labels = { customer: "Cliente", certifier: "Organismo certificador", auditor: "Organismo auditor", internal: "Interna", authority: "Autoridad", other: "Otro" };
                return <button className={draft.entityKind === value ? "selected" : ""} disabled={draft.auditType === "customer" && value !== "customer"} key={value} type="button" onClick={() => update("entityKind", value)}><span>{draft.entityKind === value ? <Check size={13} /> : null}</span>{labels[value]}</button>;
              })}
            </div>{errors.entityKind ? <FieldError text={errors.entityKind} /> : null}</div>
            {draft.entityKind === "customer" ? <>
              <Field label="Cliente *" error={errors.customerId}><select value={draft.customerId} onChange={(event) => { const customer = customers.find((item) => item.id === event.target.value); setDraft({ ...draft, customerId: event.target.value, customerName: customer?.name ?? "" }); }}><option value="">Seleccionar cliente</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field>
              <Field label="Fecha de aviso *" error={errors.noticeDate}><input type="date" value={draft.noticeDate} onChange={(event) => update("noticeDate", event.target.value)} /></Field>
              <Field label="Medio de aviso"><select value={draft.noticeMedium} onChange={(event) => update("noticeMedium", event.target.value)}><option value="">Seleccionar</option>{["Correo electrónico", "Portal del cliente", "Carta", "Llamada", "Reunión", "Otro"].map((option) => <option key={option}>{option}</option>)}</select></Field>
            </> : draft.entityKind && draft.entityKind !== "internal" ? <>
              <Field label="Nombre del organismo"><input value={draft.organizationName} onChange={(event) => update("organizationName", event.target.value)} placeholder="Ej. SGS, Intertek" /></Field>
              <Field label="Auditor asignado"><input value={draft.externalAuditor} onChange={(event) => update("externalAuditor", event.target.value)} placeholder="Opcional al crear" /></Field>
            </> : null}
            {draft.entityKind && draft.entityKind !== "internal" ? <>
              <Field label="Nombre del contacto"><input value={draft.contactName} onChange={(event) => update("contactName", event.target.value)} /></Field>
              <Field label="Cargo"><input value={draft.contactRole} onChange={(event) => update("contactRole", event.target.value)} /></Field>
              <Field label="Correo"><input type="email" value={draft.contactEmail} onChange={(event) => update("contactEmail", event.target.value)} /></Field>
              <Field label="Teléfono"><input value={draft.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} /></Field>
            </> : null}
          </AuditSection>

          <AuditSection id="scope" number="03" title="Alcance, procesos y requisitos" subtitle="Relaciona la ocurrencia con el mapa de procesos y el marco aplicable.">
            <Field label="Alcance de auditoría *" error={errors.scope} wide><textarea rows={4} value={draft.scope} onChange={(event) => update("scope", event.target.value)} placeholder="Describe sedes, procesos, productos y límites de la revisión" /></Field>
            <div className="audit-field wide"><span className="audit-label">Procesos involucrados *</span><div className="audit-check-grid">
              {processCatalog.filter((process) => process.level === "process").map((process) => <CheckboxChip key={process.id} checked={draft.processIds.includes(process.id)} label={process.name} onClick={() => toggle("processIds", process.id)} />)}
            </div>{errors.processIds ? <FieldError text={errors.processIds} /> : null}</div>
            <div className="audit-field wide"><span className="audit-label">Norma, estándar o requisito *</span><div className="audit-check-grid standards">
              {auditStandardOptions.map((standard) => <CheckboxChip key={standard} checked={draft.standards.includes(standard)} label={standard} onClick={() => toggle("standards", standard)} />)}
            </div>{errors.standards ? <FieldError text={errors.standards} /> : null}</div>
          </AuditSection>

          <AuditSection id="schedule" number="04" title="Programación y recurrencia" subtitle="Selecciona una fecha exacta, define una periodicidad, abre una ventana o deja la fecha pendiente.">
            <div className="audit-field wide"><span className="audit-label">Tipo de programación *</span><div className="audit-card-options four">
              <ChoiceCard checked={draft.scheduleType === "exact"} label="Fecha exacta" description="Un día confirmado" onClick={() => update("scheduleType", "exact")} />
              <ChoiceCard checked={draft.scheduleType === "periodic"} disabled={draft.origin === "notice"} label="Auditoría periódica" description="Repetición por periodos" onClick={() => update("scheduleType", "periodic")} />
              <ChoiceCard checked={draft.scheduleType === "window"} label="Ventana de auditoría" description="Intervalo flexible" onClick={() => update("scheduleType", "window")} />
              <ChoiceCard checked={draft.scheduleType === "pending"} label="Fecha por confirmar" description="Programación posterior" onClick={() => update("scheduleType", "pending")} />
            </div></div>
            {draft.scheduleType === "exact" ? <>
              <Field label="Fecha *" error={errors.startDate}><input type="date" value={draft.startDate} onChange={(event) => update("startDate", event.target.value)} /></Field>
              <Field label="Hora de inicio"><input type="time" value={draft.startTime} onChange={(event) => update("startTime", event.target.value)} /></Field>
              <Field label="Hora de término"><input type="time" value={draft.endTime} onChange={(event) => update("endTime", event.target.value)} /></Field>
            </> : null}
            {draft.scheduleType === "periodic" ? <div className="audit-periodic-builder wide">
              <header><CalendarRange size={19} /><div><strong>Patrón de periodicidad</strong><span>Configura la serie por meses y años, sin depender de días de la semana.</span></div></header>
              <div className="audit-period-options" aria-label="Frecuencia de la auditoría">
                {auditPeriodOptions.map(([value, label, months]) => <button className={draft.periodicFrequency === value ? "selected" : ""} key={value} type="button" onClick={() => setDraft(normalizeAuditRules({ ...draft, periodicFrequency: value, periodicIntervalMonths: months || draft.periodicIntervalMonths, recurrence: "yes" }))}><span>{draft.periodicFrequency === value ? <Check size={12} /> : null}</span><strong>{label}</strong>{months ? <small>Cada {months} {months === 1 ? "mes" : "meses"}</small> : <small>Define el intervalo</small>}</button>)}
              </div>
              <div className="audit-periodic-fields">
                <Field label="Periodo inicial (mes y año) *" error={errors.periodicStart}><input type="month" value={draft.periodicStart} onChange={(event) => update("periodicStart", event.target.value)} /></Field>
                {draft.periodicFrequency === "custom" ? <Field label="Repetir cada (meses) *" error={errors.periodicIntervalMonths}><input max="60" min="1" type="number" value={draft.periodicIntervalMonths} onChange={(event) => update("periodicIntervalMonths", Number(event.target.value))} /></Field> : <div className="audit-periodic-readonly"><span>Intervalo</span><strong>{auditPeriodOptions.find(([value]) => value === draft.periodicFrequency)?.[1]}</strong></div>}
              </div>
              <div className="audit-period-end">
                <span className="audit-label">Finalización de la serie</span>
                <div className="audit-pill-options">
                  {([['none', 'Sin fecha de finalización'], ['until', 'Finalizar en un periodo'], ['count', 'Finalizar después de']] as const).map(([value, label]) => <button className={draft.periodicEndMode === value ? "selected" : ""} key={value} type="button" onClick={() => update("periodicEndMode", value)}><span>{draft.periodicEndMode === value ? <Check size={13} /> : null}</span>{label}</button>)}
                </div>
              </div>
              {draft.periodicEndMode === "until" ? <Field label="Periodo final (mes y año) *" error={errors.periodicUntil}><input type="month" value={draft.periodicUntil} onChange={(event) => update("periodicUntil", event.target.value)} /></Field> : null}
              {draft.periodicEndMode === "count" ? <Field label="Número de periodos *" error={errors.periodicCount}><input max="120" min="2" type="number" value={draft.periodicCount} onChange={(event) => update("periodicCount", Number(event.target.value))} /></Field> : null}
              <p className="audit-periodic-summary"><CalendarDays size={16} /><span><strong>Vista previa</strong>{auditPeriodicLabel(draft)}</span></p>
            </div> : null}
            {draft.scheduleType === "window" ? <>
              <Field label="Inicio de ventana *" error={errors.windowStart}><input type="date" value={draft.windowStart} onChange={(event) => update("windowStart", event.target.value)} /></Field>
              <Field label="Fin de ventana *" error={errors.windowEnd}><input type="date" value={draft.windowEnd} onChange={(event) => update("windowEnd", event.target.value)} /></Field>
            </> : null}
            {draft.scheduleType === "pending" ? <div className="audit-pending-banner wide"><Clock3 size={19} /><div><strong>La auditoría quedará pendiente de programación</strong><span>Podrás asignar la fecha posteriormente sin perder el registro.</span></div></div> : null}
            {draft.scheduleType !== "periodic" ? <div className="audit-field wide"><span className="audit-label">¿Tendrá una próxima revisión programable?</span><div className="audit-pill-options">
              {[['yes', 'Sí'], ['no', 'No'], ['after_result', 'Se definirá después del resultado']].map(([value, label]) => <button className={draft.recurrence === value ? "selected" : ""} disabled={draft.origin === "notice"} key={value} type="button" onClick={() => update("recurrence", value as AuditDraft["recurrence"])}><span>{draft.recurrence === value ? <Check size={13} /> : null}</span>{label}</button>)}
            </div>{draft.origin === "notice" ? <p className="audit-rule-note"><ShieldCheck size={15} /> La recurrencia automática está desactivada para auditorías por aviso.</p> : null}</div> : null}
          </AuditSection>

          <AuditSection id="team" number="05" title="Responsable y participantes" subtitle="Los usuarios asignados recibirán las notificaciones iniciales.">
            <Field label="Responsable de auditoría *" error={errors.responsibleUserId} wide><select value={draft.responsibleUserId} onChange={(event) => { const user = allUsers.find((item) => item.id === event.target.value); setDraft({ ...draft, responsibleUserId: event.target.value, responsibleName: user?.name ?? "" }); }}><option value="">Seleccionar responsable</option>{allUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
            <div className="audit-field wide"><span className="audit-label">Participantes</span><div className="audit-team-grid">
              {allUsers.map((user) => <button className={draft.participantIds.includes(user.id) ? "selected" : ""} key={user.id} type="button" onClick={() => toggle("participantIds", user.id)}><span className="audit-avatar">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><span><strong>{user.name}</strong><small>{user.id === session.userId ? session.position : "Participante interno"}</small></span>{draft.participantIds.includes(user.id) ? <CheckCircle2 size={17} /> : null}</button>)}
            </div></div>
          </AuditSection>

          <AuditSection id="documents" number="06" title="Documentación inicial" subtitle="Adjunta cartas, correos, agendas, protocolos o requisitos disponibles.">
            <label className="audit-dropzone wide"><Paperclip size={25} /><strong>Seleccionar documentos</strong><span>PDF, imágenes y archivos de oficina. Los documentos no son obligatorios para confirmar.</span><input multiple type="file" onChange={(event) => addFiles(event.target.files)} /></label>
            {draft.attachments.length ? <div className="audit-attachment-list wide">{draft.attachments.map((attachment) => <div key={attachment.id}><FileText size={17} /><span><strong>{attachment.name}</strong><small>{formatFileSize(attachment.size)} · Versión {attachment.version}</small></span><button className="icon-button" type="button" title="Quitar archivo" onClick={() => update("attachments", draft.attachments.filter((item) => item.id !== attachment.id))}><X size={15} /></button></div>)}</div> : null}
          </AuditSection>

          <div className="audit-form-footer">
            <button className="button button-secondary" type="button" onClick={onCancel}>Cancelar</button>
            <div><button className="button button-secondary" type="button" onClick={saveDraft}>Guardar borrador</button><button className="button button-primary" type="button" onClick={() => confirm()}><ShieldCheck size={17} /> Crear auditoría</button></div>
          </div>
        </div>
      </div>

      {showDuplicates ? <DuplicateDialog duplicates={duplicates} onCancel={() => setShowDuplicates(false)} onCreate={() => confirm(true)} onView={() => { setShowDuplicates(false); onCancel(); }} /> : null}
    </div>
  );
}

function AuditSuccess({ audit, onCalendar, onCreateAnother, onView }: { audit: AuditOccurrence; onCalendar: () => void; onCreateAnother: () => void; onView: () => void }) {
  return (
    <section className="audit-success-page">
      <div className="audit-success-mark"><Check size={34} /></div>
      <p className="module-kicker">Ocurrencia creada</p>
      <h2>Auditoría creada correctamente</h2>
      <code>{audit.code}</code>
      <div className="audit-success-summary">
        <div><small>Nombre</small><strong>{audit.title}</strong></div>
        <div><small>Entidad</small><strong>{audit.customerName || audit.organizationName || "Interna"}</strong></div>
        <div><small>Tipo</small><strong>{auditTypeLabels[audit.auditType as keyof typeof auditTypeLabels]}</strong></div>
        <div><small>Fecha</small><strong>{auditDateLabel(audit)}</strong></div>
        <div><small>Responsable</small><strong>{audit.responsibleName}</strong></div>
        <div><small>Estatus</small><span className={`audit-status audit-status-${audit.status}`}>{auditStatusLabels[audit.status]}</span></div>
      </div>
      <p className="audit-success-note"><History size={16} /> La ocurrencia quedó vinculada a la serie <strong>{audit.seriesId}</strong> y su trazabilidad inició con el usuario creador.</p>
      <div className="audit-success-actions"><button className="button button-primary" type="button" onClick={onView}>Ver auditoría</button><button className="button button-secondary" type="button" onClick={onCalendar}><CalendarDays size={16} /> Ir al calendario</button><button className="button button-secondary" type="button" onClick={onCreateAnother}>Crear otra</button></div>
    </section>
  );
}

function DuplicateDialog({ duplicates, onCancel, onCreate, onView }: { duplicates: AuditOccurrence[]; onCancel: () => void; onCreate: () => void; onView: () => void }) {
  return <div className="modal-backdrop" role="presentation"><div className="modal audit-duplicate-modal" role="dialog" aria-modal="true" aria-labelledby="duplicate-title"><div className="audit-duplicate-icon"><AlertTriangle size={25} /></div><h3 id="duplicate-title">Existe una auditoría similar registrada</h3><p>Coincide la entidad, tipo, norma y periodo. Revisa el registro antes de crear una nueva ocurrencia.</p><div className="audit-duplicate-list">{duplicates.map((audit) => <div key={audit.id}><span><code>{audit.code}</code><strong>{audit.title}</strong></span><small>{auditDateLabel(audit)}</small></div>)}</div><div className="modal-footer"><button className="button button-secondary" type="button" onClick={onCancel}>Cancelar</button><button className="button button-secondary" type="button" onClick={onView}>Ver auditoría</button><button className="button button-primary" type="button" onClick={onCreate}>Crear de todos modos</button></div></div></div>;
}

function AuditSection({ id, number, title, subtitle, children }: { id: string; number: string; title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="audit-form-section" id={`audit-${id}`}><header><span>{number}</span><div><h3>{title}</h3><p>{subtitle}</p></div></header><div className="audit-form-grid">{children}</div></section>;
}

function Field({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`audit-field${wide ? " wide" : ""}${error ? " invalid" : ""}`}><span className="audit-label">{label}</span>{children}{error ? <FieldError text={error} /> : null}</label>;
}

function FieldError({ text }: { text: string }) { return <small className="field-error">{text}</small>; }

function ChoiceCard({ checked, disabled, label, description, onClick }: { checked: boolean; disabled?: boolean; label: string; description?: string; onClick: () => void }) {
  return <button className={checked ? "selected" : ""} disabled={disabled} type="button" onClick={onClick}><span className="choice-radio">{checked ? <span /> : null}</span><span><strong>{label}</strong>{description ? <small>{description}</small> : null}</span></button>;
}

function CheckboxChip({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return <button className={checked ? "selected" : ""} type="button" onClick={onClick}><span>{checked ? <Check size={12} /> : null}</span>{label}</button>;
}

function AuditMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return <div className={`audit-metric audit-metric-${tone}`}><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
