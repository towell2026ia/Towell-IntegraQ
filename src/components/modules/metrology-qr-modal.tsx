"use client";

/* eslint-disable @next/next/no-img-element */

import { Check, Copy, ExternalLink, QrCode, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import type { MetrologyReport } from "@/lib/metrology-report-data";
import type { MeasurementAsset } from "@/lib/types";

export function MetrologyQrModal({ asset, lastReport, onClose }: { asset: MeasurementAsset; lastReport?: MetrologyReport; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" || !asset.publicToken ? "" : `${window.location.origin}/equipment/${asset.publicToken}`;

  useEffect(() => {
    if (!url) return;
    void QRCode.toDataURL(url, { width: 360, margin: 2, color: { dark: "#071425", light: "#ffffff" }, errorCorrectionLevel: "M" }).then(setQr);
  }, [url]);

  return <div className="modal-backdrop" role="presentation"><section className="modal metrology-qr-modal" role="dialog" aria-modal="true" aria-labelledby="metrology-qr-title"><header><div><p className="module-kicker">Portal público por equipo</p><h3 id="metrology-qr-title">Código QR · {asset.code}</h3></div><button className="icon-button" onClick={onClose} title="Cerrar" type="button"><X size={18} /></button></header><div className="metrology-qr-body"><div className="metrology-qr-image">{qr ? <img alt={`Código QR del equipo ${asset.code}`} draggable={false} src={qr} /> : <QrCode size={120} />}</div><div className="metrology-qr-detail"><span>{asset.name}</span><strong>{asset.code}</strong><small>{asset.location} · {asset.activity === "verification" ? "Verificación interna" : "Calibración externa"}</small><p>{lastReport ? `Último informe: ${lastReport.template} · ${formatDate(lastReport.completedAt)}` : "Aún no existe un informe llenado para este equipo."}</p><div><button className="button button-secondary" disabled={!url} onClick={() => { void navigator.clipboard.writeText(url).then(() => setCopied(true)); }} type="button">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Enlace copiado" : "Copiar enlace"}</button><a className="button button-primary" href={url || undefined} rel="noreferrer" target="_blank"><ExternalLink size={15} /> Probar portal</a></div></div></div><footer><p>El QR abre únicamente la ficha de este equipo y la imagen de su último informe. No muestra menús ni ofrece descarga.</p></footer></section></div>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
