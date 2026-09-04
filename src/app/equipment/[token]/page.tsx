/* eslint-disable @next/next/no-img-element */

import type { Metadata } from "next";

import { getAssetDueStatus } from "@/lib/domain";
import { getMetrologyTemplateName, latestReportForAsset } from "@/lib/metrology-report-data";
import { readMetrologyWorkspace } from "@/lib/metrology-workspace-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Estado de equipo · IntegraQ", robots: { index: false, follow: false } };

export default async function EquipmentPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = await readMetrologyWorkspace();
  const workspace = record?.values;
  const asset = workspace?.assets.find((item) => item.publicToken === token);
  if (!asset || !workspace) return <main className="metrology-public-page"><section className="metrology-public-missing"><strong>Equipo no disponible</strong><p>El código QR no corresponde a un equipo activo.</p></section></main>;
  const report = latestReportForAsset(workspace.reports, asset.id);
  const status = getAssetDueStatus(asset, new Date().toISOString().slice(0, 10));
  const statusLabel = status === "current" ? "Vigente" : status === "due_soon" ? "Próximo a vencer" : "Vencido";
  return <main className="metrology-public-page"><section className="metrology-public-shell"><header><img alt="IntegraQ" src="/brand/integraq-logo.png" /><div><span>Consulta pública por QR</span><h1>{asset.name}</h1><p>{asset.code}</p></div><strong className={`metrology-public-status ${status}`}>{statusLabel}</strong></header><dl><div><dt>Actividad</dt><dd>{asset.activity === "verification" ? "Verificación interna" : "Calibración externa"}</dd></div><div><dt>Ubicación</dt><dd>{asset.location}</dd></div><div><dt>Modelo</dt><dd>{asset.model || "No especificado"}</dd></div><div><dt>Número de serie</dt><dd>{asset.serialNumber || "No especificado"}</dd></div><div><dt>Última ejecución</dt><dd>{formatDate(asset.lastCompletedAt)}</dd></div><div><dt>Próxima fecha</dt><dd>{formatDate(asset.nextDueDate)}</dd></div></dl>{report ? <section className="metrology-public-report"><header><div><span>Último informe llenado</span><h2>{getMetrologyTemplateName(report.template)}</h2><p>{formatDate(report.completedAt)} · Firmado por {report.performedBy}</p></div><em>Vista no editable</em></header><div className="metrology-public-image"><img alt={`Informe ${report.template} del equipo ${asset.code}`} draggable={false} src={`/api/metrology/public/${token}/report`} /></div></section> : <section className="metrology-public-empty"><strong>Sin informe disponible</strong><p>El equipo está registrado, pero todavía no tiene una verificación o calibración llenada en IntegraQ.</p></section>}<footer>IntegraQ · Este acceso muestra exclusivamente el equipo identificado por el código QR.</footer></section></main>;
}

function formatDate(value: string) { if (!value) return "Sin fecha"; return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
