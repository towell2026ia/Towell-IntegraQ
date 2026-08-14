"use client";

import {
  Building2,
  ChevronRight,
  FileCheck2,
  Network,
  Search,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

import { processCatalog } from "@/lib/configuration-data";
import {
  getPositionParent,
  getPositionReports,
  organizationPositions,
  processRelationshipLabels,
} from "@/lib/organization-data";

export function OrganizationModule() {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [selectedId, setSelectedId] = useState("PU-01");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return organizationPositions.filter((position) => {
      const matchesQuery =
        !normalized ||
        [position.id, position.name, position.branch].some((value) =>
          value.toLocaleLowerCase("es").includes(normalized),
        );
      const matchesLevel = level === "all" || position.level === Number(level);
      return matchesQuery && matchesLevel;
    });
  }, [level, query]);

  const selected =
    filtered.find((position) => position.id === selectedId) ??
    filtered[0] ??
    organizationPositions[0];
  const parent = getPositionParent(selected);
  const reports = getPositionReports(selected.id);
  const ownerProcessIds = new Set(
    organizationPositions.flatMap((position) =>
      position.processLinks
        .filter((link) => link.relationship === "owner")
        .map((link) => link.processId),
    ),
  );
  const positionsWithoutProcess = organizationPositions.filter(
    (position) => position.processLinks.length === 0,
  ).length;

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Estructura organizacional</p>
          <h2>Organización y puestos</h2>
          <p>Jerarquía y cruce propuesto con los procesos del Metro Map.</p>
        </div>
        <span className="module-state module-state-estructura">Propuesta para validar</span>
      </section>

      <section className="metric-grid" aria-label="Resumen del organigrama">
        <OrganizationMetric icon={<Users size={18} />} label="Puestos" value={28} tone="neutral" />
        <OrganizationMetric icon={<Network size={18} />} label="Niveles" value={4} tone="success" />
        <OrganizationMetric icon={<ShieldCheck size={18} />} label="Procesos con responsable" value={ownerProcessIds.size} tone="warning" />
        <OrganizationMetric icon={<Building2 size={18} />} label="Puestos sin proceso" value={positionsWithoutProcess} tone="danger" />
      </section>

      <section className="organization-source" aria-label="Fuente del organigrama">
        <span><FileCheck2 size={19} /></span>
        <div>
          <small>Documento fuente</small>
          <strong>F-SGC-33 Organigrama General · Versión 0</strong>
          <p>Fecha de revisión 22/11/2024 · 28 puestos identificados</p>
        </div>
      </section>

      <section className="organization-layout">
        <div className="organization-list-panel">
          <div className="configuration-toolbar">
            <label className="panel-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar puesto"
                aria-label="Buscar puesto"
              />
            </label>
            <select
              aria-label="Filtrar por nivel jerárquico"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            >
              <option value="all">Todos</option>
              <option value="1">Nivel 1</option>
              <option value="2">Nivel 2</option>
              <option value="3">Nivel 3</option>
              <option value="4">Nivel 4</option>
            </select>
          </div>
          <div className="configuration-count">{filtered.length} puestos</div>
          <div className="organization-list">
            {filtered.map((position) => (
              <button
                className={`organization-row ${position.id === selected.id ? "organization-row-selected" : ""}`}
                key={position.id}
                type="button"
                onClick={() => setSelectedId(position.id)}
              >
                <span className="organization-level">N{position.level}</span>
                <span className="organization-row-copy">
                  <strong>{position.name}</strong>
                  <small>{position.branch} · {position.id}</small>
                </span>
                <span className="organization-link-count">{position.processLinks.length}</span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </div>

        <div className="organization-detail-panel">
          <header className="organization-detail-header">
            <span className="detail-eyebrow"><UserRound size={14} /> {selected.id}</span>
            <h3>{selected.name}</h3>
            <div className="detail-status-row">
              <span className="status-badge status-open">Nivel {selected.level}</span>
              <span className="scope-badge">{selected.branch}</span>
            </div>
          </header>

          <div className="organization-facts">
            <div><small>Reporta a</small><strong>{parent?.name ?? "Máxima autoridad"}</strong></div>
            <div><small>Reportes directos</small><strong>{reports.length}</strong></div>
            <div><small>Procesos vinculados</small><strong>{selected.processLinks.length}</strong></div>
          </div>

          <section className="organization-section">
            <div className="section-title-row">
              <h4>Cruce con Metro Map</h4>
              <span className="count-badge">{selected.processLinks.length}</span>
            </div>
            {selected.processLinks.length > 0 ? (
              <div className="position-process-list">
                {selected.processLinks.map((link) => {
                  const process = processCatalog.find((item) => item.id === link.processId);
                  return (
                    <div key={`${link.processId}-${link.relationship}`}>
                      <span><strong>{link.processId}</strong><small>{process?.name ?? "Proceso por confirmar"}</small></span>
                      <span className={`relationship-badge relationship-${link.relationship}`}>
                        {processRelationshipLabels[link.relationship]}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="organization-gap">
                <ShieldCheck size={18} />
                <span><strong>Sin proceso directo en el Metro Map</strong><small>Validar si requiere un proceso propio o participación transversal.</small></span>
              </div>
            )}
          </section>

          {reports.length > 0 ? (
            <section className="organization-section">
              <div className="section-title-row"><h4>Reportes directos</h4><span className="count-badge">{reports.length}</span></div>
              <div className="direct-reports-list">
                {reports.map((report) => (
                  <button key={report.id} type="button" onClick={() => setSelectedId(report.id)}>
                    <span className="organization-level">N{report.level}</span>
                    <span><strong>{report.name}</strong><small>{report.id}</small></span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="configuration-actions">
            <button className="button button-secondary" type="button" disabled>Editar jerarquía</button>
            <button className="button button-primary" type="button" disabled>Asignar proceso</button>
          </div>
        </div>
      </section>
    </>
  );
}

function OrganizationMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span className="metric-icon">{icon}</span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}
