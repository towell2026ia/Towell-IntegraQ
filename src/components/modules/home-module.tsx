"use client";

import {
  AlertOctagon,
  ArrowRight,
  BellRing,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileClock,
  FilePenLine,
  FileWarning,
  Gauge,
  ListChecks,
  Network,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import {
  buildHomeDashboard,
  emptyHomeDashboardFilters,
  searchHomeDashboard,
  type HomeDashboardFilters,
  type HomeDashboardSources,
  type HomePriority,
  type HomeTone,
} from "@/lib/home-dashboard";
import { workspaceModuleMeta, type WorkspaceModuleId } from "@/lib/navigation";

interface HomeModuleProps {
  onNavigate: (module: WorkspaceModuleId, targetId?: string) => void;
  sources: HomeDashboardSources;
  loading?: boolean;
}

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const documentIcons = {
  reviewed: FileClock,
  pending: FilePenLine,
  validation: Clock3,
  current: FileCheck2,
  rejected: FileWarning,
};

const moduleIcons: Partial<Record<WorkspaceModuleId, LucideIcon>> = {
  documents: FileCheck2,
  risks: Target,
  indicators: Gauge,
  audits: ShieldCheck,
  "corrective-actions": ClipboardCheck,
  "management-review": ListChecks,
  calibrations: Wrench,
  customers: Network,
  processes: Network,
  organization: UserRound,
};

export function HomeModule({ onNavigate, sources, loading = false }: HomeModuleProps) {
  const [asOf] = useState(() => new Date());
  const [filters, setFilters] = useState<HomeDashboardFilters>(emptyHomeDashboardFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const dashboard = useMemo(
    () => buildHomeDashboard(sources, filters, asOf),
    [asOf, filters, sources],
  );
  const searchResults = useMemo(
    () => searchHomeDashboard(dashboard.searchIndex, searchQuery),
    [dashboard.searchIndex, searchQuery],
  );
  const firstName = sources.session.name.split(" ")[0];
  const greeting = getGreeting(asOf);
  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => key === "from" || key === "to" ? Boolean(value) : value !== "all",
  ).length;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstResult = searchResults[0];
    if (firstResult) openSearchResult(firstResult.module, firstResult.id);
  }

  function openSearchResult(module: WorkspaceModuleId, targetId?: string) {
    setSearchQuery("");
    setSearchFocused(false);
    onNavigate(module, targetId);
  }

  if (loading) return <HomeDashboardSkeleton />;

  return (
    <div className="home-dashboard">
      <section className="home-command-header" aria-labelledby="home-greeting">
        <div className="home-command-identity">
          <span className="home-command-avatar" aria-hidden="true">{sources.session.initials}</span>
          <div>
            <p>{sources.session.department} · {sources.session.position}</p>
            <h2 id="home-greeting">{greeting}, {firstName}</h2>
            <span><CalendarDays size={14} /> {capitalize(dateFormatter.format(asOf))}</span>
          </div>
        </div>

        <div className="home-global-search-wrap">
          <form className="home-global-search" role="search" onSubmit={submitSearch}>
            <Search size={18} />
            <input
              aria-label="Buscar en IntegraQ"
              autoComplete="off"
              placeholder="Buscar documentos, acciones, indicadores o procesos"
              value={searchQuery}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
              onChange={(event) => setSearchQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
            />
            {searchQuery ? (
              <button type="button" title="Limpiar búsqueda" aria-label="Limpiar búsqueda" onClick={() => setSearchQuery("")}>
                <X size={16} />
              </button>
            ) : null}
          </form>
          {searchFocused && searchQuery.trim().length >= 2 ? (
            <div className="home-search-results" role="listbox" aria-label="Resultados autorizados">
              {searchResults.length ? searchResults.map((result) => {
                const Icon = moduleIcons[result.module] ?? Search;
                return (
                  <button key={`${result.module}-${result.id}`} type="button" onClick={() => openSearchResult(result.module, result.id)}>
                    <span><Icon size={16} /></span>
                    <span><strong>{result.title}</strong><small>{result.meta}</small></span>
                    <ChevronRight size={16} />
                  </button>
                );
              }) : <p>No hay resultados dentro de tu alcance.</p>}
            </div>
          ) : null}
        </div>

        <div className="home-command-context">
          <span><strong>{sources.session.company}</strong><small>{sources.session.site ?? "Centro principal"}</small></span>
          <span className="home-role-chip">{sources.session.userType}</span>
        </div>
      </section>

      {sources.session.userType === "Administrador" ? (
        <section className="home-admin-filter-shell" aria-label="Filtros administrativos">
          <button className="home-filter-toggle" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
            <SlidersHorizontal size={17} />
            <span>Alcance global</span>
            {activeFilterCount ? <strong>{activeFilterCount}</strong> : null}
          </button>
          {filtersOpen ? (
            <div className="home-admin-filters">
              <label>Área<select value={filters.area} onChange={(event) => setFilters((current) => ({ ...current, area: event.target.value }))}><option value="all">Todas</option>{dashboard.filterOptions.areas.map((area) => <option key={area} value={area}>{area}</option>)}</select></label>
              <label>Proceso<select value={filters.processId} onChange={(event) => setFilters((current) => ({ ...current, processId: event.target.value }))}><option value="all">Todos</option>{dashboard.filterOptions.processes.map((process) => <option key={process.id} value={process.id}>{process.id} · {process.name}</option>)}</select></label>
              <label>Responsable<select value={filters.responsible} onChange={(event) => setFilters((current) => ({ ...current, responsible: event.target.value }))}><option value="all">Todos</option>{dashboard.filterOptions.responsibles.map((responsible) => <option key={responsible} value={responsible}>{responsible}</option>)}</select></label>
              <label>Estado<select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="all">Todos</option>{dashboard.filterOptions.statuses.map((status) => { const [value, label] = status.split("|"); return <option key={status} value={value}>{label}</option>; })}</select></label>
              <label>Módulo<select value={filters.module} onChange={(event) => setFilters((current) => ({ ...current, module: event.target.value }))}><option value="all">Todos</option>{["documents", "corrective-actions", "audits", "indicators", "calibrations"].map((module) => <option key={module} value={module}>{workspaceModuleMeta[module as WorkspaceModuleId].label}</option>)}</select></label>
              <label>Desde<input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
              <label>Hasta<input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
              <button className="icon-button" type="button" title="Restablecer filtros" aria-label="Restablecer filtros" onClick={() => setFilters(emptyHomeDashboardFilters)}><RotateCcw size={17} /></button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="home-priority-grid">
        <section className="home-operation-panel home-alert-panel">
          <SectionHeader eyebrow="Atención" title="Alertas" icon={BellRing} count={dashboard.alerts.length} />
          <div className="home-alert-list">
            {dashboard.alerts.length ? dashboard.alerts.slice(0, 5).map((alert) => (
              <button key={alert.id} className={`home-alert-row home-alert-${alert.priority}`} type="button" onClick={() => onNavigate(alert.module, alert.targetId)}>
                <span>{alert.priority === "critical" ? <AlertOctagon size={17} /> : alert.priority === "attention" ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}</span>
                <span><strong>{alert.title}</strong><small>{alert.alertType} · {alert.moduleLabel}</small></span>
                <ChevronRight size={16} />
              </button>
            )) : <EmptyState icon={CheckCircle2} text="No hay alertas dentro del alcance seleccionado." />}
          </div>
        </section>

        <section className="home-operation-panel home-pending-panel">
          <SectionHeader eyebrow="Mi trabajo" title="Pendientes" icon={ListChecks} count={dashboard.pendingTasks.length} />
          <div className="home-task-list">
            {dashboard.pendingTasks.length ? dashboard.pendingTasks.slice(0, 6).map((task) => {
              const Icon = moduleIcons[task.module] ?? ClipboardCheck;
              return (
                <button key={task.id} className="home-task-row" type="button" onClick={() => onNavigate(task.module, task.targetId)}>
                  <span className={`home-task-icon home-tone-${priorityTone(task.priority)}`}><Icon size={17} /></span>
                  <span className="home-task-copy"><strong>{task.title}</strong><small>{task.detail}</small><span>{task.moduleLabel}{task.dueDate ? ` · ${formatShortDate(task.dueDate)}` : ""}</span></span>
                  <span className={`home-priority-tag home-priority-${task.priority}`}>{priorityLabel(task.priority)}</span>
                  <ChevronRight size={16} />
                </button>
              );
            }) : <EmptyState icon={CheckCircle2} text="No tienes actividades pendientes." />}
          </div>
        </section>
      </div>

      <section className="home-dashboard-section home-document-section">
        <SectionHeader eyebrow="Control documental" title="Estado documental" icon={FileCheck2} />
        <div className="home-document-metrics">
          {dashboard.documentMetrics.map((metric) => {
            const Icon = documentIcons[metric.id];
            return (
              <button key={metric.id} className={`home-document-metric home-tone-${metric.tone}`} type="button" onClick={() => onNavigate("documents")}>
                <span><Icon size={18} /></span>
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
                <small>{metric.detail}</small>
                <ArrowRight size={15} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="home-dashboard-section home-upcoming-section">
        <SectionHeader eyebrow="Calendario" title="Próximos eventos" icon={CalendarClock} count={dashboard.upcomingEvents.length} />
        <div className="home-upcoming-list">
          {dashboard.upcomingEvents.length ? dashboard.upcomingEvents.slice(0, 6).map((event) => (
            <button key={event.id} type="button" onClick={() => onNavigate(event.module, event.targetId)}>
              <time dateTime={event.date}><strong>{formatDay(event.date)}</strong><span>{formatMonth(event.date)}</span></time>
              <span><strong>{event.title}</strong><small>{event.detail}</small></span>
              <ChevronRight size={16} />
            </button>
          )) : <EmptyState icon={CalendarDays} text="No hay eventos próximos." />}
        </div>
      </section>

      <section className="home-dashboard-section home-performance-section">
        <SectionHeader eyebrow="Sistema de Gestión" title="Desempeño" icon={ChartNoAxesCombined} />
        <div className="home-kpi-strip">
          {dashboard.kpis.map((kpi) => (
            <button key={kpi.id} className={`home-kpi home-tone-${kpi.tone}`} type="button" onClick={() => onNavigate(kpi.module)}>
              <span>{kpi.label}</span><strong>{kpi.value}</strong><small>{kpi.detail}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="home-dashboard-section home-modules-section">
        <SectionHeader eyebrow="Fuentes oficiales" title="Estado de módulos" icon={Network} />
        <div className="home-module-status-grid">
          {dashboard.moduleStatus.map((item) => {
            const Icon = item.module ? moduleIcons[item.module] ?? Network : FileWarning;
            return (
              <button key={item.id} className={`home-module-status home-tone-${item.tone}`} type="button" disabled={!item.sourceConnected || !item.module} onClick={() => item.module && onNavigate(item.module)}>
                <span><Icon size={17} /></span>
                <strong>{item.label}</strong>
                <small>{item.value}</small>
                <em>{item.detail}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="home-dashboard-section home-trends-section">
        <SectionHeader eyebrow="Lectura ejecutiva" title="Tendencias" icon={Gauge} />
        <div className="home-trend-grid">
          {dashboard.trends.map((trend) => (
            <button key={trend.id} className="home-trend-panel" type="button" onClick={() => onNavigate(trend.module)}>
              <header><span><strong>{trend.label}</strong><small>{trend.detail}</small></span><ChevronRight size={16} /></header>
              <div>
                {trend.series.map((serie) => {
                  const max = Math.max(...trend.series.map((item) => item.value), 1);
                  return (
                    <span className="home-trend-row" key={serie.label}>
                      <small>{serie.label}</small>
                      <i><b className={`home-trend-${serie.tone}`} style={{ width: `${Math.max((serie.value / max) * 100, serie.value ? 8 : 0)}%` }} /></i>
                      <strong>{serie.value}</strong>
                    </span>
                  );
                })}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="home-dashboard-section home-activity-section">
        <SectionHeader eyebrow="Trazabilidad" title="Actividad reciente" icon={Clock3} count={dashboard.recentActivity.length} />
        <div className="home-activity-list">
          {dashboard.recentActivity.length ? dashboard.recentActivity.slice(0, 7).map((activity) => {
            const Icon = moduleIcons[activity.module] ?? Clock3;
            return (
              <button key={activity.id} type="button" onClick={() => onNavigate(activity.module, activity.targetId)}>
                <span><Icon size={16} /></span>
                <span><strong>{activity.actor}</strong><small>{activity.description}</small></span>
                <time dateTime={activity.occurredAt}>{dateTimeFormatter.format(new Date(activity.occurredAt))}</time>
              </button>
            );
          }) : <EmptyState icon={Clock3} text="No hay actividad dentro del alcance seleccionado." />}
        </div>
      </section>

      <section className="home-quick-actions" aria-label="Acciones rápidas">
        <div><span>Acciones rápidas</span><small>{sources.session.userType === "Administrador" ? "Administración" : "Mi alcance"}</small></div>
        {sources.session.userType === "Administrador" ? (
          <>
            <button type="button" onClick={() => onNavigate("documents")}><FilePenLine size={16} /> Nuevo documento</button>
            <button type="button" onClick={() => onNavigate("corrective-actions")}><ClipboardCheck size={16} /> Nueva acción</button>
            <button type="button" onClick={() => onNavigate("indicators")}><Gauge size={16} /> Administrar indicador</button>
            <button type="button" onClick={() => onNavigate("audits")}><ShieldCheck size={16} /> Programar auditoría</button>
          </>
        ) : (
          <button type="button" onClick={() => onNavigate(dashboard.pendingTasks[0]?.module ?? "documents")}><Plus size={16} /> Abrir siguiente pendiente</button>
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  icon: Icon,
  count,
}: {
  eyebrow: string;
  title: string;
  icon: LucideIcon;
  count?: number;
}) {
  return (
    <header className="home-section-header">
      <span><Icon size={17} /></span>
      <div><small>{eyebrow}</small><h3>{title}</h3></div>
      {typeof count === "number" ? <strong>{count}</strong> : null}
    </header>
  );
}

function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return <div className="home-empty-state"><Icon size={18} /><span>{text}</span></div>;
}

function HomeDashboardSkeleton() {
  return (
    <div className="home-dashboard home-dashboard-loading" aria-label="Cargando Inicio" aria-busy="true">
      <div className="home-skeleton home-skeleton-header" />
      <div className="home-skeleton-grid">{Array.from({ length: 5 }, (_, index) => <div className="home-skeleton" key={index} />)}</div>
      <div className="home-skeleton-columns"><div className="home-skeleton" /><div className="home-skeleton" /></div>
    </div>
  );
}

function getGreeting(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function priorityLabel(priority: HomePriority) {
  if (priority === "critical") return "Crítica";
  if (priority === "attention") return "Atención";
  return "Normal";
}

function priorityTone(priority: HomePriority): HomeTone {
  if (priority === "critical") return "danger";
  if (priority === "attention") return "warning";
  return "neutral";
}

function formatShortDate(value: string) {
  return shortDateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`)).replace(".", "");
}

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase("es") + value.slice(1);
}
