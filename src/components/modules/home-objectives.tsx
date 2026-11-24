"use client";

import { Target, X } from "lucide-react";
import { useEffect, useState } from "react";
import { statusLabels } from "@/lib/indicator-data";
import { institutionalQualityObjectives, type HomeObjectiveIndicator } from "@/lib/home-objective-groups";
import styles from "./home-objectives.module.css";

export function HomeObjectives({ indicators = [], openIndicator, pending = false, unavailable = false }: { indicators?: HomeObjectiveIndicator[]; openIndicator?: (id: string) => void; pending?: boolean; unavailable?: boolean } = {}) {
  const [selected, setSelected] = useState<number | null>(null);

  const members = selected === null ? [] : indicators.filter(item => item.objective === institutionalQualityObjectives[selected]);
  useEffect(() => {
    if (selected === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  return <section className="home-dashboard-section home-objectives-section" aria-label="Objetivos de Calidad">
    <header className="home-section-header"><span><Target size={17} /></span><div><small>Dirección estratégica</small><h3>Objetivos de Calidad</h3></div><strong>{institutionalQualityObjectives.length}</strong></header>
    <div className={styles.groups}>{institutionalQualityObjectives.map((objective, index) =>
      <button className={styles.group} type="button" key={objective} onClick={() => setSelected(index)} aria-label={`Ver objetivo ${index + 1}: ${objective}`}>
        <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
        <span>{objective}</span>
      </button>
    )}</div>
    {selected !== null ? <div className="home-policy-viewer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setSelected(null);
    }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="home-objective-title">
        <header><h2 id="home-objective-title">Objetivo de Calidad {selected + 1}</h2><button type="button" autoFocus aria-label="Cerrar" onClick={() => setSelected(null)}><X size={20} /></button></header>
        <div className={styles.dialogBody}><p>{institutionalQualityObjectives[selected]}</p>
        {pending ? <p role="status">Cargando indicadores…</p> : unavailable ? <p role="status">La consulta de indicadores no está disponible.</p> :
          members.length === 0
            ? <p>Sin indicadores vinculados en el alcance consultado.</p>
            : <ul>{members.map(item => <li key={item.id}>
              <strong>{item.id} · {item.indicatorName}</strong>
              <p>{item.processName} · Meta {item.target}</p>
              <p>{item.result === undefined ? "Sin captura" : `${item.period} · ${item.result} · ${statusLabels[item.status]}`}</p>
              {item.history && item.history.length > 1 && <details><summary>Tendencia histórica</summary>{item.history.map(point => <p key={point.period}>{point.period} · {point.value}</p>)}</details>}
              {openIndicator && <button type="button" onClick={() => openIndicator(item.id)}>Consultar ficha y evidencias</button>}
            </li>)}</ul>}</div>

      </div>
    </div> : null}
  </section>;
}
