"use client";

import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CircleGauge,
  ClipboardCheck,
  FileUp,
  Filter,
  History,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import {
  calculateNextDueDate,
  getAssetDueStatus,
  toIsoDate,
} from "@/lib/domain";
import type {
  DueStatus,
  MeasurementActivity,
  MeasurementAsset,
} from "@/lib/types";

interface CalibrationsModuleProps {
  assets: MeasurementAsset[];
  focusId?: string;
  onAssetsChange: (assets: MeasurementAsset[]) => void;
}

const activityLabels: Record<MeasurementActivity, string> = {
  calibration: "Calibración",
  verification: "Verificación",
  both: "Ambas",
};

const dueLabels: Record<DueStatus, string> = {
  current: "Vigente",
  due_soon: "Próximo",
  overdue: "Vencido",
};

export function CalibrationsModule({
  assets,
  focusId,
  onAssetsChange,
}: CalibrationsModuleProps) {
  const today = toIsoDate(new Date());
  const focusedAsset = assets.find((asset) => asset.id === focusId) ?? null;
  const [query, setQuery] = useState(focusedAsset?.code ?? "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedAsset, setSelectedAsset] = useState<MeasurementAsset | null>(
    focusedAsset,
  );
  const [isCreateOpen, setCreateOpen] = useState(false);

  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return assets.filter((asset) => {
      const matchesQuery =
        !normalized ||
        [asset.code, asset.name, asset.location, asset.owner].some((value) =>
          value.toLocaleLowerCase("es").includes(normalized),
        );
      const status = getAssetDueStatus(asset, today);
      return (
        matchesQuery && (statusFilter === "all" || status === statusFilter)
      );
    });
  }, [assets, query, statusFilter, today]);

  const metrics = useMemo(() => {
    const statuses = assets.map((asset) => getAssetDueStatus(asset, today));
    return {
      total: assets.length,
      current: statuses.filter((status) => status === "current").length,
      dueSoon: statuses.filter((status) => status === "due_soon").length,
      overdue: statuses.filter((status) => status === "overdue").length,
    };
  }, [assets, today]);

  const completeActivity = (asset: MeasurementAsset, completedAt: string) => {
    onAssetsChange(
      assets.map((item) =>
        item.id === asset.id
          ? {
              ...item,
              lastCompletedAt: completedAt,
              nextDueDate: calculateNextDueDate(
                completedAt,
                item.frequencyMonths,
              ),
              evidenceCount: item.evidenceCount + 1,
            }
          : item,
      ),
    );
    setSelectedAsset(null);
  };

  const addAsset = (asset: Omit<MeasurementAsset, "id" | "evidenceCount">) => {
    onAssetsChange([
      { ...asset, id: crypto.randomUUID(), evidenceCount: 0 },
      ...assets,
    ]);
    setCreateOpen(false);
  };

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Control metrológico</p>
          <h2>Calibración y verificación</h2>
          <p>Vigencias, recurrencias y evidencia de equipos de medición.</p>
        </div>
        <button className="button button-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={17} />
          Nuevo equipo
        </button>
      </section>

      <section className="metric-grid" aria-label="Resumen de equipos">
        <CalibrationMetric
          icon={<CircleGauge size={19} />}
          label="Equipos controlados"
          value={metrics.total}
          tone="neutral"
        />
        <CalibrationMetric
          icon={<ShieldCheck size={19} />}
          label="Vigentes"
          value={metrics.current}
          tone="success"
        />
        <CalibrationMetric
          icon={<CalendarClock size={19} />}
          label="Próximos 30 días"
          value={metrics.dueSoon}
          tone="warning"
        />
        <CalibrationMetric
          icon={<AlertTriangle size={19} />}
          label="Vencidos"
          value={metrics.overdue}
          tone="danger"
        />
      </section>

      <section className="table-panel">
        <div className="table-toolbar">
          <div>
            <h3>Padrón de equipos</h3>
            <span>{filteredAssets.length} equipos visibles</span>
          </div>
          <div className="table-toolbar-actions">
            <label className="panel-search wide">
              <Search size={16} />
              <input
                aria-label="Buscar equipo"
                placeholder="Código, equipo o ubicación"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="filter-control">
              <Filter size={15} />
              <select
                aria-label="Filtrar vigencia"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">Todos</option>
                <option value="current">Vigentes</option>
                <option value="due_soon">Próximos</option>
                <option value="overdue">Vencidos</option>
              </select>
            </label>
          </div>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Equipo</th>
                <th>Actividad</th>
                <th>Ubicación</th>
                <th>Última ejecución</th>
                <th>Próxima fecha</th>
                <th>Estado</th>
                <th>Responsable</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset) => {
                const status = getAssetDueStatus(asset, today);
                return (
                  <tr key={asset.id}>
                    <td>
                      <div className="equipment-cell">
                        <div className="equipment-icon">
                          <Wrench size={17} />
                        </div>
                        <span>
                          <strong>{asset.name}</strong>
                          <small>{asset.code}</small>
                        </span>
                      </div>
                    </td>
                    <td>{activityLabels[asset.activity]}</td>
                    <td>{asset.location}</td>
                    <td>{formatDate(asset.lastCompletedAt)}</td>
                    <td>
                      <strong>{formatDate(asset.nextDueDate)}</strong>
                    </td>
                    <td>
                      <span className={`due-badge due-${status}`}>
                        {dueLabels[status]}
                      </span>
                    </td>
                    <td>{asset.owner}</td>
                    <td>
                      <button
                        className="icon-button compact-button"
                        title="Registrar ejecución"
                        type="button"
                        onClick={() => setSelectedAsset(asset)}
                      >
                        <ClipboardCheck size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mobile-asset-list">
          {filteredAssets.map((asset) => {
            const status = getAssetDueStatus(asset, today);
            return (
              <article className="asset-mobile-row" key={asset.id}>
                <div className="asset-mobile-header">
                  <div>
                    <small>{asset.code}</small>
                    <strong>{asset.name}</strong>
                  </div>
                  <span className={`due-badge due-${status}`}>
                    {dueLabels[status]}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Actividad</dt>
                    <dd>{activityLabels[asset.activity]}</dd>
                  </div>
                  <div>
                    <dt>Próxima fecha</dt>
                    <dd>{formatDate(asset.nextDueDate)}</dd>
                  </div>
                  <div>
                    <dt>Responsable</dt>
                    <dd>{asset.owner}</dd>
                  </div>
                </dl>
                <button
                  className="button button-secondary button-full"
                  type="button"
                  onClick={() => setSelectedAsset(asset)}
                >
                  <ClipboardCheck size={16} />
                  Registrar ejecución
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="operations-strip">
        <div>
          <History size={20} />
          <span>
            <strong>Historial trazable</strong>
            <small>Certificados y verificaciones por equipo</small>
          </span>
        </div>
        <div>
          <CalendarCheck size={20} />
          <span>
            <strong>Recurrencia automática</strong>
            <small>La siguiente fecha nace de la ejecución real</small>
          </span>
        </div>
        <div>
          <SlidersHorizontal size={20} />
          <span>
            <strong>Reglas configurables</strong>
            <small>Frecuencia y patrón por tipo de equipo</small>
          </span>
        </div>
      </section>

      {selectedAsset ? (
        <CompleteActivityModal
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onSubmit={(date) => completeActivity(selectedAsset, date)}
        />
      ) : null}

      {isCreateOpen ? (
        <CreateAssetModal
          onClose={() => setCreateOpen(false)}
          onSubmit={addAsset}
        />
      ) : null}
    </>
  );
}

function CalibrationMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "neutral" | "danger" | "warning" | "success";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function CompleteActivityModal({
  asset,
  onClose,
  onSubmit,
}: {
  asset: MeasurementAsset;
  onClose: () => void;
  onSubmit: (date: string) => void;
}) {
  const today = toIsoDate(new Date());
  const [completedAt, setCompletedAt] = useState(today);
  const nextDate = calculateNextDueDate(completedAt, asset.frequencyMonths);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal-compact" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <p className="module-kicker">{asset.code}</p>
            <h3>Registrar ejecución</h3>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Cerrar"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(completedAt);
          }}
        >
          <div className="completion-summary">
            <Wrench size={20} />
            <div>
              <strong>{asset.name}</strong>
              <span>{activityLabels[asset.activity]}</span>
            </div>
          </div>
          <div className="form-grid single-column">
            <label className="field">
              <span>Fecha de ejecución</span>
              <input
                required
                type="date"
                value={completedAt}
                onChange={(event) => setCompletedAt(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Resultado</span>
              <select defaultValue="approved">
                <option value="approved">Conforme</option>
                <option value="adjusted">Con ajuste</option>
                <option value="rejected">Fuera de servicio</option>
              </select>
            </label>
            <label className="field">
              <span>Evidencia</span>
              <span className="file-control">
                <FileUp size={17} />
                <input type="file" aria-label="Adjuntar certificado o evidencia" />
              </span>
            </label>
          </div>
          <div className="next-date-callout">
            <CalendarCheck size={18} />
            <span>
              <small>Siguiente fecha calculada</small>
              <strong>{formatDate(nextDate)}</strong>
            </span>
          </div>
          <div className="modal-footer">
            <button className="button button-ghost" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="button button-primary" type="submit">
              <CheckCircle2 size={16} />
              Guardar ejecución
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateAssetModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (asset: Omit<MeasurementAsset, "id" | "evidenceCount">) => void;
}) {
  const today = toIsoDate(new Date());
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [owner, setOwner] = useState("");
  const [activity, setActivity] =
    useState<MeasurementActivity>("verification");
  const [frequencyMonths, setFrequencyMonths] = useState(3);
  const [lastCompletedAt, setLastCompletedAt] = useState(today);
  const [standard, setStandard] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({
      code,
      name,
      location,
      owner,
      activity,
      frequencyMonths,
      lastCompletedAt,
      nextDueDate: calculateNextDueDate(lastCompletedAt, frequencyMonths),
      standard,
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <p className="module-kicker">Control metrológico</p>
            <h3>Registrar nuevo equipo</h3>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Cerrar"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field">
              <span>Código</span>
              <input
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="EQ-MET-000"
              />
            </label>
            <label className="field">
              <span>Actividad</span>
              <select
                value={activity}
                onChange={(event) =>
                  setActivity(event.target.value as MeasurementActivity)
                }
              >
                {Object.entries(activityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-span-2">
              <span>Nombre del equipo</span>
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Equipo o instrumento"
              />
            </label>
            <label className="field">
              <span>Ubicación</span>
              <input
                required
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Responsable</span>
              <input
                required
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Frecuencia (meses)</span>
              <input
                required
                type="number"
                min={1}
                max={60}
                value={frequencyMonths}
                onChange={(event) =>
                  setFrequencyMonths(Number(event.target.value))
                }
              />
            </label>
            <label className="field">
              <span>Última ejecución</span>
              <input
                required
                type="date"
                value={lastCompletedAt}
                onChange={(event) => setLastCompletedAt(event.target.value)}
              />
            </label>
            <label className="field field-span-2">
              <span>Patrón o referencia</span>
              <input
                required
                value={standard}
                onChange={(event) => setStandard(event.target.value)}
                placeholder="Patrón trazable o método aplicable"
              />
            </label>
          </div>
          <div className="modal-footer">
            <button className="button button-ghost" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="button button-primary" type="submit">
              <Plus size={16} />
              Registrar equipo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}
