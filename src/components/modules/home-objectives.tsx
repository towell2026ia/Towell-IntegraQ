"use client";

import { Target, X } from "lucide-react";
import { useEffect, useState } from "react";
import { institutionalQualityObjectives } from "@/lib/home-objective-groups";
import styles from "./home-objectives.module.css";

export function HomeObjectives() {
  const [selected, setSelected] = useState<number | null>(null);

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
        <p className={styles.dialogBody}>{institutionalQualityObjectives[selected]}</p>
      </div>
    </div> : null}
  </section>;
}
