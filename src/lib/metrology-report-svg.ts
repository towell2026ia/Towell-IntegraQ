import { getMetrologyTemplateName, inspectionLabels, type CalibrationValues, type LengthVerificationValues, type MetrologyReport, type ScaleVerificationValues } from "@/lib/metrology-report-data";
import type { MeasurementAsset } from "@/lib/types";

function escape(value: unknown) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function cell(value: unknown) { return `<td>${escape(value) || "—"}</td>`; }
function row(values: unknown[]) { return `<tr>${values.map(cell).join("")}</tr>`; }

export function renderMetrologyReportSvg(asset: MeasurementAsset, report: MetrologyReport) {
  const body = report.template === "F-CA-51" ? scaleBody(report.values as ScaleVerificationValues) : report.template === "F-CA-53" ? lengthBody(report.values as LengthVerificationValues) : calibrationBody(report.values as CalibrationValues);
  const height = report.template === "F-CA-53" ? 1680 : report.template === "F-CA-51" ? 1540 : 1020;
  const result = report.result === "accepted" ? "CONFORME" : report.result === "conditional" ? "CON AJUSTE / CONDICIONADO" : "NO CONFORME / FUERA DE SERVICIO";
  const signature = report.signatureDataUrl?.startsWith("data:image/") ? `<img class="signature" src="${escape(report.signatureDataUrl)}" alt="Firma libre"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${height}" viewBox="0 0 1100 ${height}">
<rect width="1100" height="${height}" fill="#eef2ef"/>
<foreignObject x="35" y="35" width="1030" height="${height - 70}">
<div xmlns="http://www.w3.org/1999/xhtml" class="page">
<style>
*{box-sizing:border-box}body{margin:0}.page{width:100%;min-height:${height - 70}px;padding:28px 34px;background:#fff;color:#102019;font-family:Arial,sans-serif;font-size:14px}.head{display:grid;grid-template-columns:1fr 2.5fr 1.1fr;border:2px solid #24342d}.brand,.title,.control{display:grid;place-items:center;min-height:94px;padding:12px;text-align:center}.brand{font-weight:800;font-size:20px;border-right:1px solid #24342d}.title{border-right:1px solid #24342d}.title strong{font-size:22px}.title small{margin-top:5px;color:#52645b}.control{display:block;text-align:left;font-size:12px}.control div{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #c8d0cc}.identity{display:grid;grid-template-columns:1fr 1fr;margin-top:15px;border:1px solid #24342d}.identity div{display:grid;grid-template-columns:190px 1fr;padding:8px;border-bottom:1px solid #c8d0cc}.identity div:nth-child(odd){border-right:1px solid #c8d0cc}.identity .wide{grid-column:1/-1;border-right:0}.identity strong{font-size:12px;text-transform:uppercase}.section{margin-top:16px;border:1px solid #24342d}.section h3{margin:0;padding:8px;background:#edf2ef;border-bottom:1px solid #24342d;text-align:center;font-size:15px;text-transform:uppercase}.section p{margin:0;padding:10px;white-space:pre-wrap}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}table{width:100%;border-collapse:collapse}th,td{padding:6px 7px;border:1px solid #738078;text-align:center;font-size:12px}th{background:#f0f3f1;font-weight:800}.notes{min-height:70px;text-align:left}.sign{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:18px}.sign>div{min-height:120px;padding:12px;border:1px solid #738078;text-align:center}.signature{display:block;max-width:280px;max-height:64px;margin:4px auto}.result{display:inline-block;margin:14px 0 0;padding:8px 12px;color:#145c4d;background:#e1f4ed;font-weight:800}.muted{color:#617168;font-size:12px}.footer{margin-top:14px;padding-top:8px;border-top:1px solid #c8d0cc;color:#617168;text-align:center;font-size:11px}
</style>
<div class="head"><div class="brand">Towel S.A. de C.V.</div><div class="title"><strong>${escape(getMetrologyTemplateName(report.template))}</strong><small>Informe digital no editable</small></div><div class="control"><div><span>Código</span><b>${escape(report.template)}</b></div><div><span>Equipo</span><b>${escape(asset.code)}</b></div><div><span>Fecha</span><b>${escape(report.completedAt)}</b></div></div></div>
<div class="identity"><div><strong>Referencia interna</strong><span>${escape(asset.code)}</span></div><div><strong>Ubicación</strong><span>${escape(asset.location)}</span></div><div><strong>Equipo</strong><span>${escape(asset.name)}</span></div><div><strong>Modelo / serie</strong><span>${escape([asset.model, asset.serialNumber].filter(Boolean).join(" · ")) || "—"}</span></div><div class="wide"><strong>Responsable</strong><span>${escape(report.performedBy)}</span></div></div>
${body}
<span class="result">Resultado: ${result}</span>
<div class="sign"><div><strong>Firma con usuario autenticado</strong><p>${escape(report.performedBy)}</p><span class="muted">${escape(report.signedAt)}</span></div><div><strong>Firma libre</strong>${signature || '<p class="muted">No agregada; aplica la firma con usuario.</p>'}</div></div>
<div class="footer">IntegraQ · Consulta pública por QR · Vista sin controles de descarga</div>
</div></foreignObject></svg>`;
}

function scaleBody(values: ScaleVerificationValues) {
  return `<div class="section"><h3>Inspección visual</h3><table><thead>${row(["Apartado", "Inspección visual", "Resultado"])}</thead><tbody>${Object.entries(values.visual).map(([name, result], index) => row([index + 1, name, inspectionLabels[result]])).join("")}</tbody></table></div>
  <div class="grid2"><div class="section"><h3>Excentricidad</h3><p>Carga de prueba: ${escape(values.eccentricityLoad)}</p><table><tbody>${values.eccentricity.map((reading, index) => row([`Punto ${index + 1}`, reading])).join("")}</tbody></table></div><div class="section"><h3>Repetibilidad</h3><p>Estabilización: ${escape(values.stabilization.join(" · "))}</p><table><tbody>${values.repeatability.map((reading, index) => row([`Punto ${index + 1}`, reading])).join("")}</tbody></table></div></div>
  <div class="section"><h3>Error de indicación</h3><table><thead>${row(["Lectura", "Valor nominal", "L. ascendente"])}</thead><tbody>${values.indication.map((item) => row([item.reading, item.nominal, item.ascending])).join("")}</tbody></table></div>
  <div class="grid2"><div class="section"><h3>Patrones utilizados</h3><p class="notes">${escape(values.standards)}</p></div><div class="section"><h3>Observaciones</h3><p class="notes">${escape(values.observations)}</p></div></div>`;
}

function lengthBody(values: LengthVerificationValues) {
  return `<div class="grid2"><div class="section"><h3>Inspección visual</h3><table><thead>${row(["Apartado", "Inspección visual", "Resultado"])}</thead><tbody>${Object.entries(values.visual).map(([name, result], index) => row([index + 1, name, inspectionLabels[result]])).join("")}</tbody></table></div><div class="section"><h3>Condiciones ambientales</h3><table><thead>${row(["Momento", "Temperatura", "Humedad"])}</thead><tbody>${row(["Inicial", values.initialTemperature, values.initialHumidity])}${row(["Final", values.finalTemperature, values.finalHumidity])}</tbody></table><p>Unidades: ${escape(values.units)}</p></div></div>
  <div class="section"><h3>Error de medida</h3><table><thead>${row(["Dimensión", "1", "2", "3", "Promedio"])}</thead><tbody>${values.measurements.map((item) => row([item.dimension, item.first, item.second, item.third, item.average])).join("")}</tbody></table></div>
  <div class="section"><h3>Observaciones</h3><p class="notes">${escape(values.observations)}</p></div>`;
}

function calibrationBody(values: CalibrationValues) {
  return `<div class="section"><h3>Informe de calibración externa</h3><table><tbody>${row(["Proveedor / laboratorio", values.provider])}${row(["Certificado", values.certificate])}${row(["Alcance calibrado", values.scope])}${row(["Incertidumbre", values.uncertainty])}</tbody></table></div><div class="section"><h3>Observaciones</h3><p class="notes">${escape(values.observations)}</p></div>`;
}
