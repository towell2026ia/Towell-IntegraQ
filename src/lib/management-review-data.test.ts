import { describe, expect, it } from "vitest";

import { demoCorrectiveActions, demoMeasurementAssets } from "@/lib/demo-data";
import { buildInitialControlledDocuments } from "@/lib/document-control-data";
import { buildInitialIndicatorDefinitions, buildInitialIndicatorResults } from "@/lib/indicator-data";
import {
  approveManagementReviewAsOperations,
  approveManagementReviewAsSgc,
  buildAnnualManagementReviewPeriod,
  buildDemoManagementReviewHistory,
  buildManagementReviewContext,
  createManagementReviewRecord,
  type ManagementReviewAiDraft,
  type ManagementReviewSources,
} from "@/lib/management-review-data";
import {
  activeCertifications,
  customerQualityCatalog,
  externalAuditCalendar,
  rncpDashboardSummary,
  supplierAuditSemesters,
  supplierQualityCatalog,
} from "@/lib/quality-parties-data";
import { activeSession } from "@/lib/session-data";

const now = new Date("2026-08-14T16:00:00.000Z");
const draft: ManagementReviewAiDraft = {
  mode: "demo",
  executiveSummary: "Resumen",
  sections: [],
  keyFindings: [],
  decisions: [],
  warnings: [],
};

function buildSources(): ManagementReviewSources {
  return {
    session: activeSession,
    documents: buildInitialControlledDocuments(),
    actions: demoCorrectiveActions,
    assets: demoMeasurementAssets,
    indicators: buildInitialIndicatorDefinitions(),
    indicatorResults: buildInitialIndicatorResults(),
    supplierAudits: supplierAuditSemesters.flatMap((semester) => semester.events),
    externalAudits: externalAuditCalendar,
    customers: customerQualityCatalog,
    suppliers: supplierQualityCatalog,
    certifications: activeCertifications,
    rncpSummary: rncpDashboardSummary,
  };
}

describe("management review aggregation and approvals", () => {
  it("captures connected and pending sources without inventing records", () => {
    const context = buildManagementReviewContext(
      buildSources(),
      buildAnnualManagementReviewPeriod(2026),
      now,
    );

    expect(context.sources.find((source) => source.id === "documents")?.recordCount).toBeGreaterThan(0);
    expect(context.sources.find((source) => source.id === "risks")).toMatchObject({
      status: "pending",
      recordCount: 0,
    });
    expect(context.sources.find((source) => source.id === "continuous-improvement")).toMatchObject({
      status: "pending",
      recordCount: 0,
    });
  });

  it("creates a single traceable record from the captured context", () => {
    const context = buildManagementReviewContext(buildSources(), undefined, now);
    const record = createManagementReviewRecord(context, draft);

    expect(record.id).toBe("RPD-2026-01");
    expect(record.generatedOnce).toBe(true);
    expect(record.contextFingerprint).toBe(context.fingerprint);
    expect(record.sourceSnapshot).toEqual(context.sources);
  });

  it("enforces SGC approval before the operations approval", () => {
    const context = buildManagementReviewContext(buildSources(), undefined, now);
    const record = createManagementReviewRecord(context, draft);
    const operationsSession = {
      ...activeSession,
      userId: "USR-OPS-001",
      userType: "Usuario" as const,
      position: "Dirección de Operaciones",
    };

    const premature = approveManagementReviewAsOperations(
      record,
      operationsSession,
      "Conforme",
      "2026-08-14T17:00:00.000Z",
    );
    expect(premature.status).toBe("draft");

    const sgcApproved = approveManagementReviewAsSgc(
      record,
      activeSession,
      "Validada",
      "2026-08-14T17:00:00.000Z",
    );
    const completed = approveManagementReviewAsOperations(
      sgcApproved,
      operationsSession,
      "Autorizada",
      "2026-08-14T18:00:00.000Z",
    );

    expect(sgcApproved.status).toBe("sgc_approved");
    expect(completed.status).toBe("operations_approved");
    expect(completed.approvals[1].approverPosition).toBe("Dirección de Operaciones");
  });

  it("provides closed annual records with both historical authorizations", () => {
    const history = buildDemoManagementReviewHistory();

    expect(history.map((record) => record.period.year)).toEqual([2025, 2024]);
    expect(history.every((record) => record.status === "operations_approved")).toBe(true);
    expect(history.every((record) => record.approvals.every((approval) => approval.status === "approved"))).toBe(true);
  });
});

