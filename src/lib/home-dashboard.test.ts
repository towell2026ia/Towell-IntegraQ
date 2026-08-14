import { describe, expect, it } from "vitest";

import { demoCorrectiveActions, demoMeasurementAssets } from "@/lib/demo-data";
import {
  approveDocumentVersion,
  buildInitialControlledDocuments,
} from "@/lib/document-control-data";
import {
  buildHomeDashboard,
  searchHomeDashboard,
  type HomeDashboardSources,
} from "@/lib/home-dashboard";
import {
  buildInitialIndicatorDefinitions,
  buildInitialIndicatorResults,
} from "@/lib/indicator-data";
import {
  externalAuditCalendar,
  supplierAuditSemesters,
} from "@/lib/quality-parties-data";
import { activeSession, type ActiveSession } from "@/lib/session-data";

const asOf = new Date("2026-08-14T16:00:00.000Z");

function buildSources(session: ActiveSession = activeSession): HomeDashboardSources {
  return {
    session,
    documents: buildInitialControlledDocuments(),
    actions: demoCorrectiveActions,
    assets: demoMeasurementAssets,
    indicators: buildInitialIndicatorDefinitions(),
    indicatorResults: buildInitialIndicatorResults(),
    supplierAudits: supplierAuditSemesters.flatMap((semester) => semester.events),
    externalAudits: externalAuditCalendar,
  };
}

describe("home dashboard aggregation", () => {
  it("recalculates document counters from the controlled document source", () => {
    const sources = buildSources();
    const initial = buildHomeDashboard(sources, undefined, asOf);
    const pendingBefore = initial.documentMetrics.find((metric) => metric.id === "pending")?.value;
    const pendingDocument = sources.documents.find((document) =>
      document.versions.some((version) => version.status === "pending"),
    );

    expect(pendingDocument).toBeDefined();
    const approved = approveDocumentVersion(
      pendingDocument!,
      activeSession.name,
      "2026-08-14T17:00:00.000Z",
    );
    const updated = buildHomeDashboard(
      {
        ...sources,
        documents: sources.documents.map((document) =>
          document.id === approved.id ? approved : document,
        ),
      },
      undefined,
      asOf,
    );

    expect(updated.documentMetrics.find((metric) => metric.id === "pending")?.value)
      .toBe((pendingBefore ?? 0) - 1);
  });

  it("limits documents and search results to an assigned process for a standard user", () => {
    const standardSession: ActiveSession = {
      ...activeSession,
      userId: "USR-DOC-001",
      userType: "Usuario",
      assignedProcessIds: ["P-08"],
    };
    const dashboard = buildHomeDashboard(buildSources(standardSession), undefined, asOf);
    const visibleDocuments = searchHomeDashboard(dashboard.searchIndex, "documento");
    const forbiddenProcess = searchHomeDashboard(dashboard.searchIndex, "P-01");

    expect(visibleDocuments.every((result) => result.module !== "documents" || result.meta.includes("Calidad"))).toBe(true);
    expect(forbiddenProcess).toHaveLength(0);
  });

  it("derives overdue action alerts and module status from the same action records", () => {
    const dashboard = buildHomeDashboard(buildSources(), undefined, asOf);
    const overdueActions = demoCorrectiveActions.filter(
      (action) => action.status !== "closed" && action.dueDate < "2026-08-14",
    ).length;
    const actionModule = dashboard.moduleStatus.find((module) => module.id === "corrective-actions");
    const criticalActionAlerts = dashboard.alerts.filter(
      (alert) => alert.module === "corrective-actions" && alert.priority === "critical",
    );

    expect(actionModule?.detail).toBe(`${overdueActions} vencidas`);
    expect(criticalActionAlerts).toHaveLength(overdueActions);
  });
});
