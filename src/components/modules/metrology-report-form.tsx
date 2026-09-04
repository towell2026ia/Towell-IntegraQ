"use client";

import { CheckCircle2, Eraser, PenLine, Save, X } from "lucide-react";
import { type FormEvent, type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

import { calculateNextDueDate, toIsoDate } from "@/lib/domain";
import { getVerificationReadiness } from "@/lib/metrology-data";
import { buildReportIdentity, getMetrologyReportTemplate, getMetrologyTemplateName, lengthInspectionItems, scaleInspectionItems, type InspectionResult, type LengthVerificationValues, type MetrologyReport, type MetrologyResult, type ScaleVerificationValues } from "@/lib/metrology-report-data";
import type { ActiveSession } from "@/lib/session-data";
import type { MeasurementAsset } from "@/lib/types";

interface Props {
  asset: MeasurementAsset;
  assets: MeasurementAsset[];
  onClose: () => void;
  onSave: (report: MetrologyReport) => Promise<void>;
  session: ActiveSession;
}

export function MetrologyReportForm({ asset, assets, onClose, onSave, session }: Props) {
  const template = getMetrologyReportTemplate(asset);
  const [completedAt, setCompletedAt] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<MetrologyResult>("accepted");
  const [signature, setSignature] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const readiness = getVerificationReadiness(asset, assets, completedAt);
  const nextDueDate = calculateAssetNextDueDate(asset, completedAt);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (asset.activity === "verification" && !readiness.ready) throw new Error(readiness.reason);
      const form = new FormData(event.currentTarget);
      const common = { ...buildReportIdentity(asset, session, template, completedAt, nextDueDate), result, signatureDataUrl: signature };
      const values = template === "F-CA-51" ? scaleValues(form) : template === "F-CA-53" ? lengthValues(form) : calibrationValues(form);
      await onSave({ ...common, values });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar el informe.");
    } finally {
      setSubmitting(false);
    }
  }

  const referenceNames = readiness.currentReferences.map((item) => `${item.code} · ${item.name}`).join("; ");

  return <div className="modal-backdrop metrology-form-backdrop" role="presentation"><section className="modal metrology-form-modal" role="dialog" aria-modal="true" aria-labelledby="metrology-form-title"><header className="metrology-form-header"><div><p>{template}</p><h3 id="metrology-form-title">{getMetrologyTemplateName(template)}</h3><span>Towel S.A. de C.V. · Formato digital controlado</span></div><button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={19} /></button></header>
    <form onSubmit={submit}>
      <section className="metrology-form-identification"><label><span>Número de referencia interno</span><input disabled value={asset.code} /></label><label><span>Fecha</span><input required type="date" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} /></label><label><span>Periodicidad de verificación</span><input defaultValue={asset.frequencyDays ? `${asset.frequencyDays} días` : `${asset.frequencyMonths} meses`} name="periodicity" required /></label><label><span>Ubicación</span><input disabled value={asset.location} /></label><label className="span-2"><span>Nombre del encargado de la verificación</span><input defaultValue={session.name} name="inspector" required /></label></section>
      {asset.activity === "verification" ? <p className={`metrology-readiness-inline ${readiness.ready ? "ready" : "blocked"}`}>{readiness.ready ? <CheckCircle2 size={15} /> : <X size={15} />}{readiness.reason}</p> : null}

      {template === "F-CA-51" ? <ScaleFields referenceNames={referenceNames} /> : null}
      {template === "F-CA-53" ? <LengthFields /> : null}
      {template === "CALIBRATION" ? <CalibrationFields asset={asset} /> : null}

      <section className="metrology-signature-section"><div><p className="module-kicker">Cierre del informe</p><h4>Resultado y firma</h4></div><div className="metrology-signature-controls"><label><span>Resultado</span><select value={result} onChange={(event) => setResult(event.target.value as MetrologyResult)}><option value="accepted">Conforme</option><option value="conditional">Con ajuste / condicionado</option><option value="rejected">No conforme / fuera de servicio</option></select></label><label><span>Firma con usuario</span><input disabled value={`${session.name} · ${session.position}`} /></label></div><SignaturePad onChange={setSignature} /></section>
      {error ? <p className="form-error metrology-form-error">{error}</p> : null}
      <footer className="metrology-form-footer"><span><CheckCircle2 size={15} /> Se guardará con fecha, usuario y trazabilidad del equipo.</span><div><button className="button button-ghost" onClick={onClose} type="button">Cancelar</button><button className="button button-primary" disabled={submitting} type="submit"><Save size={16} /> {submitting ? "Guardando…" : "Firmar y guardar"}</button></div></footer>
    </form>
  </section></div>;
}

function InspectionFields({ items }: { items: readonly string[] }) {
  return <section className="metrology-controlled-section"><header><h4>Inspección visual</h4><small>X · No aceptable &nbsp; ✓ · Aceptable &nbsp; N/A · No aplica</small></header><div className="metrology-inspection-table"><div className="table-head"><span>Apartado</span><span>Inspección visual</span><span>Resultado</span></div>{items.map((item, index) => <div key={item}><span>{index + 1}</span><strong>{item}</strong><select aria-label={`Resultado de ${item}`} defaultValue="accepted" name={`visual-${index}`}><option value="accepted">✓ Aceptable</option><option value="not_accepted">X No aceptable</option><option value="na">N/A No aplica</option></select></div>)}</div></section>;
}

function ScaleFields({ referenceNames }: { referenceNames: string }) {
  return <>
    <InspectionFields items={scaleInspectionItems} />
    <div className="metrology-two-column-sections"><section className="metrology-controlled-section"><header><h4>Excentricidad</h4><small>Una pesa patrón de 1/4, 1/3 o 1/2 del alcance máximo.</small></header><label className="metrology-inline-field"><span>Prueba con carga de</span><input name="eccentricityLoad" required /></label><MeasurementInputs count={5} label="Punto" name="eccentricity" /></section><section className="metrology-controlled-section"><header><h4>Repetibilidad</h4><small>Para cargas ≥ 100 kg se realizan tres mediciones.</small></header><div className="metrology-stabilization"><span>Tiempo de estabilización</span>{[0, 1, 2].map((index) => <input aria-label={`Tiempo ${index + 1}`} key={index} name={`stabilization-${index}`} placeholder={`Tiempo ${index + 1}`} />)}</div><MeasurementInputs count={5} label="Punto" name="repeatability" /></section></div>
    <section className="metrology-controlled-section"><header><h4>Error de indicación</h4></header><div className="metrology-measurement-table indication"><div className="table-head"><span>Lectura</span><span>Valor nominal</span><span>L. ascendente</span></div>{Array.from({ length: 7 }, (_, index) => <div key={index}><span>{index + 1}</span><input aria-label={`Valor nominal ${index + 1}`} name={`nominal-${index}`} /><input aria-label={`Lectura ascendente ${index + 1}`} name={`ascending-${index}`} /></div>)}</div></section>
    <section className="metrology-notes-grid"><label><span>Patrones utilizados</span><textarea defaultValue={referenceNames} name="standards" required rows={3} /></label><label><span>Observaciones</span><textarea name="observations" rows={3} /></label></section>
  </>;
}

function LengthFields() {
  const [measurements, setMeasurements] = useState(() => Array.from({ length: 13 }, () => ({ dimension: "", first: "", second: "", third: "", average: "" })));
  function change(index: number, key: "dimension" | "first" | "second" | "third", value: string) {
    setMeasurements((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const next = { ...row, [key]: value };
      const rawReadings = [next.first, next.second, next.third];
      const readings = rawReadings.map(Number);
      next.average = rawReadings.every((reading) => reading.trim() !== "") && readings.every(Number.isFinite) ? (readings.reduce((sum, reading) => sum + reading, 0) / 3).toFixed(3) : "";
      return next;
    }));
  }
  return <>
    <div className="metrology-two-column-sections"><InspectionFields items={lengthInspectionItems} /><section className="metrology-controlled-section environmental"><header><h4>Condiciones ambientales</h4></header><div><span /><strong>Temperatura</strong><strong>Humedad</strong><span>Inicial</span><input name="initialTemperature" /><input name="initialHumidity" /><span>Final</span><input name="finalTemperature" /><input name="finalHumidity" /></div></section></div>
    <section className="metrology-controlled-section"><label className="metrology-inline-field"><span>Unidades en</span><input name="units" required placeholder="mm, cm o m" /></label><header><h4>Error de medida</h4></header><div className="metrology-measurement-table length"><div className="table-head"><span>Dimensión</span><span>1</span><span>2</span><span>3</span><span>Promedio</span></div>{measurements.map((row, index) => <div key={index}><input aria-label={`Dimensión ${index + 1}`} name={`dimension-${index}`} value={row.dimension} onChange={(event) => change(index, "dimension", event.target.value)} /><input aria-label={`Medición 1 fila ${index + 1}`} name={`first-${index}`} value={row.first} onChange={(event) => change(index, "first", event.target.value)} /><input aria-label={`Medición 2 fila ${index + 1}`} name={`second-${index}`} value={row.second} onChange={(event) => change(index, "second", event.target.value)} /><input aria-label={`Medición 3 fila ${index + 1}`} name={`third-${index}`} value={row.third} onChange={(event) => change(index, "third", event.target.value)} /><input aria-label={`Promedio fila ${index + 1}`} name={`average-${index}`} readOnly value={row.average} /></div>)}</div></section>
    <section className="metrology-notes-grid single"><label><span>Observaciones</span><textarea name="observations" rows={4} /></label></section>
  </>;
}

function CalibrationFields({ asset }: { asset: MeasurementAsset }) {
  return <section className="metrology-controlled-section"><header><h4>Informe de calibración externa</h4><small>Registro asociado exclusivamente al equipo seleccionado.</small></header><div className="metrology-calibration-fields"><label><span>Proveedor / laboratorio</span><input defaultValue={asset.externalProvider} name="provider" required /></label><label><span>Número de certificado</span><input defaultValue={asset.calibrationReport} name="certificate" required /></label><label><span>Alcance calibrado</span><input defaultValue={asset.measurementRange} name="scope" required /></label><label><span>Incertidumbre declarada</span><input name="uncertainty" /></label><label className="span-2"><span>Observaciones</span><textarea name="observations" rows={4} /></label></div></section>;
}

function MeasurementInputs({ count, label, name }: { count: number; label: string; name: string }) { return <div className="metrology-point-list">{Array.from({ length: count }, (_, index) => <label key={index}><span>{label} {index + 1}</span><input name={`${name}-${index}`} /></label>)}</div>; }

function SignaturePad({ onChange }: { onChange: (value?: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  function point(event: ReactPointerEvent<HTMLCanvasElement>) { const canvas = canvasRef.current; if (!canvas) return { x: 0, y: 0 }; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; }
  function start(event: ReactPointerEvent<HTMLCanvasElement>) { const canvas = canvasRef.current; if (!canvas) return; drawing.current = true; canvas.setPointerCapture(event.pointerId); const context = canvas.getContext("2d"); const current = point(event); context?.beginPath(); context?.moveTo(current.x, current.y); }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const canvas = canvasRef.current; const context = canvas?.getContext("2d"); const current = point(event); if (!context) return; context.lineWidth = 3; context.lineCap = "round"; context.strokeStyle = "#14231c"; context.lineTo(current.x, current.y); context.stroke(); }
  function end() { drawing.current = false; const canvas = canvasRef.current; if (canvas) onChange(canvas.toDataURL("image/png")); }
  function clear() { const canvas = canvasRef.current; canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); onChange(undefined); }
  return <div className="metrology-signature-pad"><header><span><PenLine size={15} /> Firma libre opcional</span><button onClick={clear} type="button"><Eraser size={14} /> Limpiar</button></header><canvas aria-label="Área para firma libre" height={150} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} ref={canvasRef} width={640} /><small>Si se deja en blanco, la firma válida será el nombre del usuario autenticado.</small></div>;
}

function scaleValues(form: FormData): ScaleVerificationValues { return { periodicity: String(form.get("periodicity")), inspector: String(form.get("inspector")), visual: Object.fromEntries(scaleInspectionItems.map((item, index) => [item, String(form.get(`visual-${index}`)) as InspectionResult])), stabilization: Array.from({ length: 3 }, (_, index) => String(form.get(`stabilization-${index}`))), eccentricityLoad: String(form.get("eccentricityLoad")), eccentricity: Array.from({ length: 5 }, (_, index) => String(form.get(`eccentricity-${index}`))), repeatability: Array.from({ length: 5 }, (_, index) => String(form.get(`repeatability-${index}`))), indication: Array.from({ length: 7 }, (_, index) => ({ reading: String(index + 1), nominal: String(form.get(`nominal-${index}`)), ascending: String(form.get(`ascending-${index}`)) })), standards: String(form.get("standards")), observations: String(form.get("observations")) }; }
function lengthValues(form: FormData): LengthVerificationValues { return { periodicity: String(form.get("periodicity")), inspector: String(form.get("inspector")), visual: Object.fromEntries(lengthInspectionItems.map((item, index) => [item, String(form.get(`visual-${index}`)) as InspectionResult])), initialTemperature: String(form.get("initialTemperature")), initialHumidity: String(form.get("initialHumidity")), finalTemperature: String(form.get("finalTemperature")), finalHumidity: String(form.get("finalHumidity")), units: String(form.get("units")), measurements: Array.from({ length: 13 }, (_, index) => ({ dimension: String(form.get(`dimension-${index}`)), first: String(form.get(`first-${index}`)), second: String(form.get(`second-${index}`)), third: String(form.get(`third-${index}`)), average: String(form.get(`average-${index}`)) })), observations: String(form.get("observations")) }; }
function calibrationValues(form: FormData) { return { provider: String(form.get("provider")), certificate: String(form.get("certificate")), scope: String(form.get("scope")), uncertainty: String(form.get("uncertainty")), observations: String(form.get("observations")) }; }

function calculateAssetNextDueDate(asset: MeasurementAsset, completedAt: string) {
  if (!asset.frequencyDays) return calculateNextDueDate(completedAt, asset.frequencyMonths);
  const completed = new Date(`${completedAt}T00:00:00Z`);
  completed.setUTCDate(completed.getUTCDate() + asset.frequencyDays);
  return toIsoDate(completed);
}
