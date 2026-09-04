"use client";

import { CalendarDays, Check, FlaskConical, Save, Search, Settings2, Wrench, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { calculateMetrologyNextDueDate } from "@/lib/metrology-report-data";
import type { MeasurementActivity, MeasurementAsset } from "@/lib/types";

export function MetrologyAssetManager({ assets, onClose, onSave }: { assets: MeasurementAsset[]; onClose: () => void; onSave: (asset: MeasurementAsset) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(assets[0]?.id ?? "");
  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-MX");
    return assets.filter((asset) => !normalized || [asset.code, asset.name, asset.location, asset.owner].some((value) => value.toLocaleLowerCase("es-MX").includes(normalized)));
  }, [assets, query]);

  return <div className="modal-backdrop metrology-manager-backdrop" role="presentation"><section className="metrology-manager-modal" role="dialog" aria-modal="true" aria-labelledby="metrology-manager-title"><header><span><Settings2 size={20} /></span><div><small>Administración del padrón</small><h3 id="metrology-manager-title">Editar o ajustar equipos</h3><p>Los plazos definidos aquí gobiernan el calendario y la reprogramación.</p></div><button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={19} /></button></header><div className="metrology-manager-layout"><aside><label className="panel-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar equipo" /></label><div className="metrology-manager-list">{filtered.map((asset) => <button className={asset.id === selected?.id ? "selected" : ""} key={asset.id} onClick={() => setSelectedId(asset.id)} type="button"><span className={asset.isReferenceStandard ? "standard" : ""}>{asset.isReferenceStandard ? <FlaskConical size={15} /> : <Wrench size={15} />}</span><div><small>{asset.code}{asset.isReferenceStandard ? " · Patrón" : ""}</small><strong>{asset.name}</strong><em>{asset.location}</em></div></button>)}</div></aside>{selected ? <AssetAdjustForm asset={selected} assets={assets} key={selected.id} onSave={onSave} /> : <div className="metrology-manager-empty">No hay equipos registrados.</div>}</div></section></div>;
}

function AssetAdjustForm({ asset, assets, onSave }: { asset: MeasurementAsset; assets: MeasurementAsset[]; onSave: (asset: MeasurementAsset) => Promise<void> }) {
  const initialUnit = asset.frequencyDays ? "days" : "months";
  const [code, setCode] = useState(asset.code);
  const [name, setName] = useState(asset.name);
  const [location, setLocation] = useState(asset.location);
  const [owner, setOwner] = useState(asset.owner);
  const [activity, setActivity] = useState<MeasurementActivity>(asset.activity);
  const [isReferenceStandard, setReferenceStandard] = useState(Boolean(asset.isReferenceStandard));
  const [frequencyUnit, setFrequencyUnit] = useState<"days" | "months">(initialUnit);
  const [frequencyValue, setFrequencyValue] = useState(initialUnit === "days" ? asset.frequencyDays ?? 30 : asset.frequencyMonths);
  const [lastCompletedAt, setLastCompletedAt] = useState(asset.lastCompletedAt);
  const [standard, setStandard] = useState(asset.standard);
  const [referenceStandardId, setReferenceStandardId] = useState(asset.referenceStandardId ?? "");
  const [externalProvider, setExternalProvider] = useState(asset.externalProvider ?? "");
  const [measurementCategory, setMeasurementCategory] = useState(asset.measurementCategory ?? "");
  const [model, setModel] = useState(asset.model ?? "");
  const [serialNumber, setSerialNumber] = useState(asset.serialNumber ?? "");
  const [measurementRange, setMeasurementRange] = useState(asset.measurementRange ?? "");
  const [resolution, setResolution] = useState(asset.resolution ?? "");
  const [observations, setObservations] = useState(asset.observations ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const effectiveActivity: MeasurementActivity = isReferenceStandard ? "calibration" : activity;
  const schedulingAsset = { ...asset, frequencyDays: frequencyUnit === "days" ? frequencyValue : undefined, frequencyMonths: frequencyUnit === "months" ? frequencyValue : Math.max(1, Math.round(frequencyValue / 30)) };
  const nextDueDate = calculateMetrologyNextDueDate(schedulingAsset, lastCompletedAt);
  const standards = assets.filter((candidate) => candidate.isReferenceStandard && candidate.id !== asset.id);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setFeedback("");
    try {
      const next: MeasurementAsset = {
        ...asset, code: code.trim(), name: name.trim(), location: location.trim(), owner: owner.trim(),
        activity: effectiveActivity,
        isReferenceStandard,
        frequencyMonths: schedulingAsset.frequencyMonths,
        frequencyDays: schedulingAsset.frequencyDays,
        lastCompletedAt,
        nextDueDate,
        schedulePending: false,
        standard: standard.trim(),
        measurementCategory: measurementCategory.trim(), model: model.trim(), serialNumber: serialNumber.trim(), measurementRange: measurementRange.trim(), resolution: resolution.trim(), observations: observations.trim(),
        referenceStandardId: effectiveActivity === "verification" ? referenceStandardId || undefined : undefined,
        referenceStandardIds: effectiveActivity === "verification" && referenceStandardId ? [referenceStandardId] : undefined,
        externalProvider: effectiveActivity === "calibration" ? externalProvider.trim() || undefined : undefined,
      };
      await onSave(next);
      setFeedback("Ajuste guardado y calendario recalculado.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "No fue posible guardar el ajuste."); }
    finally { setSaving(false); }
  }

  return <form className="metrology-adjust-form" onSubmit={submit}><header><div><small>{asset.code}</small><h4>{asset.name}</h4></div><span className={effectiveActivity === "calibration" ? "calibration" : "verification"}>{effectiveActivity === "calibration" ? "Calibración externa" : "Verificación interna"}</span></header><div className="metrology-adjust-grid"><label><span>Código</span><input required value={code} onChange={(event) => setCode(event.target.value)} /></label><label><span>Tipo de control</span><select disabled={isReferenceStandard} value={activity} onChange={(event) => setActivity(event.target.value as MeasurementActivity)}><option value="verification">Verificación interna</option><option value="calibration">Calibración externa</option></select></label><label className="span-2 metrology-standard-toggle"><input checked={isReferenceStandard} onChange={(event) => { setReferenceStandard(event.target.checked); if (event.target.checked) setActivity("calibration"); }} type="checkbox" /><span>Es un patrón calibrado externamente</span></label><label className="span-2"><span>Nombre del equipo</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>Ubicación</span><input required value={location} onChange={(event) => setLocation(event.target.value)} /></label><label><span>Responsable</span><input required value={owner} onChange={(event) => setOwner(event.target.value)} /></label><label><span>Magnitud</span><input value={measurementCategory} onChange={(event) => setMeasurementCategory(event.target.value)} /></label><label><span>Modelo</span><input value={model} onChange={(event) => setModel(event.target.value)} /></label><label><span>Número de serie</span><input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></label><label><span>Alcance</span><input value={measurementRange} onChange={(event) => setMeasurementRange(event.target.value)} /></label><label><span>Resolución</span><input value={resolution} onChange={(event) => setResolution(event.target.value)} /></label>{effectiveActivity === "verification" ? <label><span>Patrón para verificación</span><select required value={referenceStandardId} onChange={(event) => setReferenceStandardId(event.target.value)}><option value="">Seleccionar patrón</option>{standards.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.code} · {candidate.name}</option>)}</select></label> : <label><span>Proveedor externo</span><input value={externalProvider} onChange={(event) => setExternalProvider(event.target.value)} placeholder="Opcional" /></label>}<label className="span-2"><span>Método, criterio o referencia</span><input required value={standard} onChange={(event) => setStandard(event.target.value)} /></label><label className="span-2"><span>Observaciones</span><textarea value={observations} onChange={(event) => setObservations(event.target.value)} /></label></div><section className="metrology-schedule-adjust"><header><CalendarDays size={18} /><div><small>Regla del calendario</small><strong>Plazo de {effectiveActivity === "calibration" ? "calibración" : "verificación"}</strong></div></header><div><label><span>Plazo</span><input min="1" max={frequencyUnit === "days" ? 1825 : 60} required type="number" value={frequencyValue} onChange={(event) => setFrequencyValue(Math.max(1, Number(event.target.value)))} /></label><label><span>Unidad</span><select value={frequencyUnit} onChange={(event) => setFrequencyUnit(event.target.value as "days" | "months")}><option value="days">Días</option><option value="months">Meses</option></select></label><label><span>Fecha base</span><input required type="date" value={lastCompletedAt} onChange={(event) => setLastCompletedAt(event.target.value)} /></label><div><small>Próxima fecha calculada</small><strong>{formatDate(nextDueDate)}</strong></div></div></section>{feedback ? <p className="metrology-adjust-feedback"><Check size={15} />{feedback}</p> : null}<footer><button className="button button-primary" disabled={saving || (effectiveActivity === "verification" && !referenceStandardId)} type="submit"><Save size={16} /> {saving ? "Guardando…" : "Guardar ajuste y recalcular"}</button></footer></form>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
