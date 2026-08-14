"use client";

import {
  Building2,
  CircleDot,
  CornerDownRight,
  Download,
  FilePenLine,
  Map,
  Network,
  Search,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import { MetroMapEditor } from "@/components/modules/metromap-editor";
import { processCatalog } from "@/lib/configuration-data";
import {
  getPositionsForProcess,
  processRelationshipLabels,
} from "@/lib/organization-data";

export function ProcessesModule() {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [selectedId, setSelectedId] = useState("P-01");
  const [editorOpen, setEditorOpen] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return processCatalog.filter((process) => {
      const matchesQuery =
        !normalized ||
        [process.id, process.name, process.sourceLabel].some((value) =>
          value.toLocaleLowerCase("es").includes(normalized),
        );
      const matchesLevel = level === "all" || process.level === level;
      return matchesQuery && matchesLevel;
    });
  }, [level, query]);

  const selected =
    processCatalog.find((process) => process.id === selectedId) ?? processCatalog[0];
  const parent = selected.parentId
    ? processCatalog.find((process) => process.id === selected.parentId)
    : undefined;
  const children = processCatalog.filter(
    (process) => process.parentId === selected.id,
  );
  const positionLinks = getPositionsForProcess(selected.id);

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Configuración base</p>
          <h2>Procesos y subprocesos</h2>
          <p>Jerarquía validada del Metro Map, preparada para asignar alcance.</p>
        </div>
        <div className="module-heading-actions">
          <span className="draft-badge">34 en borrador</span>
          <button className="button button-primary" type="button" onClick={() => setEditorOpen(true)}>
            <FilePenLine size={17} /> Editar Metro Map
          </button>
        </div>
      </section>

      <section className="metric-grid" aria-label="Resumen de procesos">
        <ProcessMetric label="Procesos" value={20} tone="neutral" />
        <ProcessMetric label="Subprocesos" value={14} tone="success" />
        <ProcessMetric label="Jerarquías" value={5} tone="warning" />
        <ProcessMetric label="Alcance pendiente" value={34} tone="danger" />
      </section>

      <section className="metromap-source" aria-label="Archivo fuente del Metro Map">
        <span className="metromap-source-icon"><Map size={20} /></span>
        <div className="metromap-source-copy">
          <small>Archivo fuente cargado</small>
          <strong>MetroMap Towel.drawio</strong>
          <span>
            2 páginas: Towel y T
            {lastSavedAt ? ` · edición local ${new Date(lastSavedAt).toLocaleString("es-MX")}` : ""}
          </span>
        </div>
        <a
          className="icon-button metromap-download"
          href="/api/metromap?download=1"
          title="Descargar archivo original"
        >
          <Download size={18} />
        </a>
      </section>

      <section className="configuration-layout">
        <div className="configuration-list-panel">
          <div className="configuration-toolbar">
            <label className="panel-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar proceso"
                aria-label="Buscar proceso"
              />
            </label>
            <select
              aria-label="Filtrar por nivel"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            >
              <option value="all">Todos</option>
              <option value="process">Procesos</option>
              <option value="subprocess">Subprocesos</option>
            </select>
          </div>
          <div className="configuration-count">{filtered.length} elementos</div>
          <div className="process-list">
            {filtered.map((process) => (
              <button
                className={`process-row ${
                  process.id === selected.id ? "process-row-selected" : ""
                } ${process.level === "subprocess" ? "process-row-child" : ""}`}
                key={process.id}
                type="button"
                onClick={() => setSelectedId(process.id)}
              >
                <span className="process-row-icon">
                  {process.level === "subprocess" ? (
                    <CornerDownRight size={15} />
                  ) : (
                    <CircleDot size={16} />
                  )}
                </span>
                <span className="process-row-copy">
                  <strong>{process.name}</strong>
                  <small>{process.id}{process.parentId ? ` · ${process.parentId}` : ""}</small>
                </span>
                <span className={`level-badge level-${process.level}`}>
                  {process.level === "process" ? "Proceso" : "Subproceso"}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="configuration-detail-panel">
          <div className="configuration-detail-header">
            <span className="detail-eyebrow">
              <Network size={14} /> {selected.id}
            </span>
            <h3>{selected.name}</h3>
            <div className="detail-status-row">
              <span className="status-badge status-open">{selected.status}</span>
              <span className="scope-badge">{selected.scope}</span>
            </div>
          </div>

          <div className="configuration-facts">
            <div>
              <span><Network size={16} /></span>
              <div><small>Nivel</small><strong>{selected.level === "process" ? "Proceso" : "Subproceso"}</strong></div>
            </div>
            <div>
              <span><CornerDownRight size={16} /></span>
              <div><small>Proceso padre</small><strong>{parent?.name ?? "No aplica"}</strong></div>
            </div>
            <div>
              <span><CircleDot size={16} /></span>
              <div><small>Representación</small><strong>{selected.representation}</strong></div>
            </div>
            <div>
              <span><Building2 size={16} /></span>
              <div><small>Área</small><strong>Por asignar</strong></div>
            </div>
            <div>
              <span><UserRound size={16} /></span>
              <div><small>Responsable</small><strong>Por asignar</strong></div>
            </div>
          </div>

          <section className="configuration-section">
            <div className="section-title-row">
              <h4>Nombre en Metro Map</h4>
            </div>
            <p>{selected.sourceLabel}</p>
          </section>

          <section className="configuration-section">
            <div className="section-title-row">
              <h4>Puestos relacionados</h4>
              <span className="count-badge">{positionLinks.length}</span>
            </div>
            {positionLinks.length > 0 ? (
              <div className="process-position-list">
                {positionLinks.map(({ position, relationship }) => (
                  <div key={`${position.id}-${relationship}`}>
                    <span><strong>{position.name}</strong><small>{position.id}</small></span>
                    <span className={`relationship-badge relationship-${relationship}`}>
                      {processRelationshipLabels[relationship]}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p>Sin puesto relacionado; requiere validación organizacional.</p>
            )}
          </section>

          {children.length > 0 ? (
            <section className="configuration-section">
              <div className="section-title-row">
                <h4>Subprocesos</h4>
                <span className="count-badge">{children.length}</span>
              </div>
              <div className="child-process-list">
                {children.map((child) => (
                  <button key={child.id} type="button" onClick={() => setSelectedId(child.id)}>
                    <CornerDownRight size={15} />
                    <span><strong>{child.name}</strong><small>{child.id}</small></span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="configuration-actions">
            <button className="button button-secondary" type="button" disabled>
              Asignar responsable
            </button>
            <button className="button button-primary" type="button" disabled>
              Definir alcance
            </button>
          </div>
        </div>
      </section>

      {editorOpen ? (
        <MetroMapEditor
          onClose={() => setEditorOpen(false)}
          onSaved={setLastSavedAt}
        />
      ) : null}
    </>
  );
}

function ProcessMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span className="metric-icon"><Network size={18} /></span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}
