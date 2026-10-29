"use client";
import { Target } from "lucide-react";
import { groupHomeObjectives, type HomeObjectiveIndicator } from "@/lib/home-objective-groups";
import styles from "./home-objectives.module.css";

export function HomeObjectives({ items, onOpenIndicator }: {
  items: HomeObjectiveIndicator[];
  onOpenIndicator: (id: string) => void;
}) {
  const { groups, unassigned } = groupHomeObjectives(items);
  const sections = [...groups, ...(unassigned.length ? [{ name: "Sin objetivo asignado", indicators: unassigned }] : [])];
  return <section className="home-dashboard-section home-objectives-section" aria-label="Objetivos e indicadores de calidad">
    <header className="home-section-header"><span><Target size={17} /></span><div><small>Dirección estratégica</small><h3>Objetivos de Calidad</h3></div><strong>{groups.length}</strong></header>
    <p className={styles.count}>{items.length} indicadores en el alcance autorizado · {groups.length} objetivos con asignación</p>
    <div className={styles.groups}>{sections.map((section) => <details key={section.name} open className={styles.group}>
      <summary>{section.name}<span>{section.indicators.length} indicadores</span></summary>
      <ul>{section.indicators.map((indicator) => <li key={indicator.id}><button type="button" onClick={() => onOpenIndicator(indicator.id)}>
        <strong>{indicator.id} · {indicator.indicatorName}</strong><span>{indicator.processName}</span><small>Meta: {indicator.target} · {indicator.leader}</small>
      </button></li>)}</ul>
    </details>)}</div>
    {!items.length ? <p className="home-empty-state">No hay indicadores dentro de los procesos autorizados.</p> : null}
  </section>;
}
