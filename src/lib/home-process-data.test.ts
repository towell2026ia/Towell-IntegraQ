import { describe, it, expect } from "vitest";
import { aggregateProcessHome, type HomeRecords } from "./home-process-data";
import { activeSession, type ActiveSession } from "./session-data";
import { emptyHomeDashboardFilters } from "./home-dashboard";

const now = new Date("2026-11-03T12:34:56Z");
const session: ActiveSession = { ...activeSession, authUserId: "user", userType: "Usuario interno", assignedProcessIds: ["quality"], documentAccess: [{ processId: "quality", role: "authorizer", inheritedFromPositionId: "test" }], assignedModuleIds: ["home", "documents", "indicators", "corrective-actions"], moduleActionPermissions: [{ moduleId: "indicators", action: "update" }, { moduleId: "documents", action: "approve" }] };
function data(): HomeRecords { return {
  processes: [{ id: "quality", name: "Calidad" }, { id: "sales", name: "Ventas" }],
  indicators: [{ id: "kpi", code: "KPI-1", name: "Resultado", process_id: "quality", active: true, periodicity: "quarterly", leader_id: "user", metric_label: ">= 90%" }],
  indicatorProcesses: [{ indicator_id: "kpi", process_id: "quality" }, { indicator_id: "kpi", process_id: "sales" }],
  rules: [{ indicator_id: "kpi", compliant_rule: ">=90", marginal_rule: ">=80,<90", noncompliant_rule: "<80" }],
  periods: [{ id: "q1", indicator_id: "kpi", year: 2026, quarter: "Q1" }, { id: "q2", indicator_id: "kpi", year: 2026, quarter: "Q2" }, { id: "q3", indicator_id: "kpi", year: 2026, quarter: "Q3", opens_at: "2026-11-01", closes_at: "2026-11-05" }],
  results: [{ id: "r1", period_id: "q1", value: 0, submitted_at: "2026-04-02T10:11:12Z", submitted_by: "user" }, { id: "r2", period_id: "q2", value: 95, submitted_at: "2026-07-03T09:08:07Z", submitted_by: "user" }],
  documents: [{ id: "doc", process_id: "quality", code: "PR-01", title: "Proceso", active: true }],
  versions: [{ id: "v", document_id: "doc", revision: 1, status: "pending", validator_id: "user" }],
}; }
describe("Inicio: datos reales por proceso y responsabilidad", () => {
  it("conserva cero como medición y no fabrica un punto para Q3", () => {
    const d = aggregateProcessHome(session, data(), undefined, now);
    expect(d.trends[0].series.map(s => [s.label,s.value])).toEqual([["2026 Q1",0],["2026 Q2",100]]);
    expect(d.kpis[0].detail).toContain("1 capturas");
    expect(d.pendingTasks.map(t => t.targetId)).toEqual(["doc", "KPI-1"]);
  });
  it("no duplica el KPI relacionado con dos procesos", () => {
    const d = aggregateProcessHome(session, data(), undefined, now);
    expect(d.recentActivity.filter(a => a.module === "indicators")).toHaveLength(2);
    expect(d.kpis[0].value).toBe("100%");
  });
  it("Ventas no recibe documentos de Calidad", () => {
    const d = aggregateProcessHome(session, data(), { ...emptyHomeDashboardFilters, processId: "sales" }, now);
    expect(d.documentMetrics.every(m => m.value === 0)).toBe(true);
    expect(d.pendingTasks.some(t => t.targetId === "doc")).toBe(false);
  });
  it("un usuario distinto no recibe tareas ajenas aunque pueda consultar el proceso", () => {
    const d = aggregateProcessHome({ ...session, authUserId: "other" }, data(), undefined, now);
    expect(d.pendingTasks).toEqual([]);
  });
  it("sin históricos no presenta porcentajes ni tendencias simuladas", () => {
    const rows = data(); rows.results = [];
    const d = aggregateProcessHome(session, rows, undefined, now);
    expect(d.trends.every(t => t.series.length === 0)).toBe(true);
    expect(d.kpis[0].value).toBe("Sin datos");
  });
  it("conserva la fecha y hora originales", () => {
    expect(aggregateProcessHome(session, data(), undefined, now).recentActivity[0].occurredAt).toBe("2026-07-03T09:08:07Z");
  });
  it("no convierte frecuencias no trimestrales ni reglas ausentes", () => {
    const rows = data(); rows.indicators[0].periodicity = "monthly";
    expect(aggregateProcessHome(session, rows, undefined, now).trends[0].series).toEqual([]);
  });
  it("excluye valores vacíos y fechas inválidas sin convertirlos en cero", () => {
    const rows = data(); rows.results[0].value = ""; rows.results[1].submitted_at = "invalid";
    expect(aggregateProcessHome(session, rows, undefined, now).trends[0].series).toEqual([]);
  });
  it("no evalúa metas cuando falta la regla persistida", () => {
    const rows = data(); rows.rules = [];
    expect(aggregateProcessHome(session, rows, undefined, now).kpis[0].value).toBe("Sin datos");
  });
  it("un usuario sin procesos conserva la estructura institucional con operación vacía", () => {
    const d = aggregateProcessHome({ ...session, assignedProcessIds: [] }, { processes: [] }, undefined, now);
    expect(d.visibleSections).toContain("quality-objectives");
    expect(d.visibleSections).toContain("quality-policy");
    expect(d.pendingTasks).toEqual([]);
    expect(d.recentActivity).toEqual([]);
  });
  it("retira documentos eliminados de métricas y pendientes sin alterar registros", () => {
    const rows = data(); rows.lifecycle = [{ document_id: "doc", is_deleted: true }];
    expect(aggregateProcessHome(session, rows, undefined, now).pendingTasks.some(t => t.targetId === "doc")).toBe(false);
    expect(rows.documents).toHaveLength(1);
  });
});
