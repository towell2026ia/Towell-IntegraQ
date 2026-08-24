"use client";

import { BarChart3, BrainCircuit, Target, TrendingUp } from "lucide-react";

import { buildFormDashboard, type AppFormDefinition } from "@/lib/form-data";

export function FormIntelligenceDashboard({ form }: { form: AppFormDefinition }) {
  const snapshot = buildFormDashboard(form);
  const trendMaximum = Math.max(...snapshot.resultTrend.map((item) => item.value), 1);
  const categoryMaximum = Math.max(...snapshot.categoryBreakdown.map((item) => item.value), 1);
  const categoryField = form.fields.find((field) => field.id === form.dashboard.categoryField);

  return (
    <div className="form-dashboard-view">
      <header className="form-intelligence-heading">
        <div>
          <span className="detail-eyebrow"><BrainCircuit size={14} /> Dashboard inteligente · V{form.dashboard.version}</span>
          <h4>{form.dashboard.objective}</h4>
          <p>{form.dashboard.agentName}</p>
        </div>
        <span className="form-dashboard-version">{form.dashboard.id}</span>
      </header>

      <section className="form-dashboard-metrics form-result-metrics" aria-label="Resultados clave del formulario">
        {snapshot.insights.map((insight) => (
          <div className={`form-result-metric ${insight.tone}`} key={insight.id}>
            <small>{insight.label}</small>
            <strong className={insight.numericValue === null ? "compact" : ""}>{insight.value}{insight.suffix ? <em>{insight.suffix}</em> : null}</strong>
            <span>{insight.detail}</span>
          </div>
        ))}
      </section>

      <section className="form-dashboard-grid">
        <div className="form-dashboard-panel">
          <div className="section-title-row">
            <h4>Tendencia · {snapshot.resultTrendLabel}</h4>
            <TrendingUp size={16} />
          </div>
          <div className="form-trend-chart" aria-label={`Tendencia de ${snapshot.resultTrendLabel}`}>
            {snapshot.resultTrend.map((item) => (
              <div key={item.label}>
                <span>{formatNumber(item.value)}{snapshot.resultTrendSuffix === "%" ? "%" : ""}</span>
                <i style={{ height: `${Math.max((item.value / trendMaximum) * 100, item.value ? 12 : 2)}%` }} />
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="form-dashboard-panel form-findings-panel">
          <div className="section-title-row">
            <h4>Resumen para decisión</h4>
            <Target size={16} />
          </div>
          <div className="form-key-findings">
            {snapshot.keyFindings.map((finding, index) => (
              <div key={finding}><span>{index + 1}</span><p>{finding}</p></div>
            ))}
          </div>
        </div>

        <div className="form-dashboard-panel form-dashboard-panel-wide">
          <div className="section-title-row">
            <h4>Resultados · {categoryField?.label ?? "Categoría principal"}</h4>
            <BarChart3 size={16} />
          </div>
          <div className="form-category-grid">
            {snapshot.categoryBreakdown.map((item) => (
              <div key={item.label}>
                <span><strong>{item.label}</strong><small>{item.value}</small></span>
                <i><b style={{ width: `${(item.value / categoryMaximum) * 100}%` }} /></i>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function formatNumber(value: number) {
  return value.toLocaleString("es-MX", { maximumFractionDigits: 1 });
}
