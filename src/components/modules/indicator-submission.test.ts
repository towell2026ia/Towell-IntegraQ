import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildInitialIndicatorDefinitions } from "@/lib/indicator-data";
import type { ActiveSession } from "@/lib/session-data";
const evidence = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock("@/components/evidence/evidence-manager", () => ({ EvidenceManager: (props: Record<string, unknown>) => { evidence.props = props; return null; } }));
import { IndicatorSubmission } from "./indicators-module";
describe("closed result detail", () => {
  it("keeps evidence consultation available while capture and replacement are disabled", () => {
    const indicator = buildInitialIndicatorDefinitions()[0];
    const session = { userId: "reader", name: "Reader", shortName: "Reader", initials: "R", position: "Viewer", department: "Calidad", company: "Towell", userType: "Usuario interno", assignedProcessIds: [indicator.processId], assignedModuleIds: ["indicators"], moduleActionPermissions: [{ moduleId: "indicators", action: "view" }] } as ActiveSession;
    const html = renderToStaticMarkup(createElement(IndicatorSubmission, { indicator, session, year: 2025, quarter: "Q1", record: { value: 95, comments: "", evidenceFileId: "existing-file", evidenceName: "existing.pdf", submittedBy: "Author", submittedAt: "2025-04-01T12:00:00Z" }, onBack: () => undefined, onResult: async () => undefined }));
    expect(evidence.props).toMatchObject({ referencedFileId: "existing-file", viewLabel: "Ver evidencia", permissions: { read: true, add: false, replace: false, delete: false, history: true } });
    expect(html).toContain("Captura no disponible");
    expect(html).not.toContain("vuelve a adjuntar");
  });
});
