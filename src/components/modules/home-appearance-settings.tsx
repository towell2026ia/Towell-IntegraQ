"use client";
import { useState, type CSSProperties } from "react";
import { homeTextSizes, type HomeTextSize } from "@/lib/home-appearance";
import { useHomeAppearance } from "@/lib/use-home-appearance";
export function HomeAppearanceSettings() {
  const { appearance, loading, error, refresh } = useHomeAppearance();
  const [draft, setDraft] = useState<HomeTextSize | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const size = draft ?? appearance.textSize;
  async function save(textSize: HomeTextSize) {
    setSaving(true); setSaveError(""); setNotice("");
    try {
      const response = await fetch("/api/home/appearance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ textSize, revision: appearance.revision }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No fue posible guardar la apariencia.");
      setDraft(null); refresh(); setNotice("Tamaño de texto guardado para este espacio de trabajo.");
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "No fue posible guardar."); }
    finally { setSaving(false); }
  }
  return <section className="home-appearance-settings" aria-label="Apariencia de Inicio">
    <h3>Apariencia</h3>
    <label>Tamaño de texto <select value={size} disabled={loading || saving || Boolean(error)} onChange={event => setDraft(Number(event.target.value) as HomeTextSize)}>
      {homeTextSizes.map(option => <option key={option.value} value={option.value}>{option.label} · {option.value}%</option>)}
    </select></label>
    <div className="home-appearance-preview" style={{ "--home-text-scale": size / 100 } as CSSProperties} aria-label="Vista previa del tamaño de texto">
      <h3>Objetivos de Calidad</h3><p>Consulta los indicadores, documentos y resultados de tus procesos autorizados.</p>
    </div>
    <div className="home-appearance-actions"><button type="button" disabled={loading || saving || Boolean(error)} onClick={() => void save(size)}>Guardar</button><button type="button" disabled={loading || saving || Boolean(error)} onClick={() => void save(100)}>Restablecer</button></div>
    {loading ? <p role="status">Consultando configuración…</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {error || saveError ? <div role="alert"><p>{error || saveError}</p><button type="button" onClick={() => { setSaveError(""); setDraft(null); refresh(); }}>Recargar configuración</button></div> : null}
  </section>;
}