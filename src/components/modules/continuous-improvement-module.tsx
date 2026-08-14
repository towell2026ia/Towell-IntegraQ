"use client";

import { CheckCircle2, FolderKanban, Lightbulb, TrendingUp } from "lucide-react";

export function ContinuousImprovementModule() {
  return (
    <div className="continuous-improvement-module">
      <div className="module-heading">
        <div>
          <span className="module-kicker">Desempeño del sistema</span>
          <h2>Mejora continua</h2>
          <p>Portafolio de oportunidades, iniciativas y beneficios validados.</p>
        </div>
        <span className="management-review-status status-not-generated">En estructuración</span>
      </div>

      <section className="continuous-summary">
        <div><Lightbulb size={18} /><span><small>Oportunidades</small><strong>0</strong></span></div>
        <div><FolderKanban size={18} /><span><small>Iniciativas activas</small><strong>0</strong></span></div>
        <div><CheckCircle2 size={18} /><span><small>Mejoras cerradas</small><strong>0</strong></span></div>
        <div><TrendingUp size={18} /><span><small>Beneficios validados</small><strong>0</strong></span></div>
      </section>

      <section className="continuous-portfolio work-panel">
        <header className="management-panel-heading">
          <div><span className="module-kicker">Portafolio</span><h3>Iniciativas y proyectos</h3></div>
        </header>
        <div className="continuous-empty">
          <span><TrendingUp size={24} /></span>
          <strong>Aún no hay iniciativas registradas</strong>
          <p>Las decisiones autorizadas en Revisión por la Dirección se incorporarán a este portafolio.</p>
        </div>
      </section>
    </div>
  );
}

