import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CorrectiveActionsModule } from "@/components/modules/corrective-actions-module";
import { ContinuousImprovementModule } from "@/components/modules/continuous-improvement-module";
import { FormsModule } from "@/components/modules/forms-module";
import { ManagementReviewModule } from "@/components/modules/management-review-module";
import { demoCorrectiveActions, enrichSavedCorrectiveActions } from "@/lib/demo-data";
import { withoutUnchangedSamples } from "@/lib/demo-cleanup";
import { appFormCatalog, normalizeAppForms } from "@/lib/form-data";
import { editableModulePermissionGroups } from "@/lib/module-permissions";
import { workspaceModuleMeta } from "@/lib/navigation";
import { activeSession } from "@/lib/session-data";

describe("módulos sin muestras al renderizar", () => {
  it("muestra Root2Cause en navegación y encabezado sin las acciones antiguas", () => {
    expect(workspaceModuleMeta["corrective-actions"].label).toBe("Root2Cause");
    expect(editableModulePermissionGroups.find(group => group.moduleId === "corrective-actions")?.label).toBe("Root2Cause");
    const saved = enrichSavedCorrectiveActions(demoCorrectiveActions);
    const actions = withoutUnchangedSamples(saved, demoCorrectiveActions);
    const html = renderToStaticMarkup(createElement(CorrectiveActionsModule, {
      actions, onActionsChange: vi.fn(), session: activeSession,
    }));
    expect(html).toContain("<h2>Root2Cause</h2>");
    expect(html).not.toMatch(/AC-2026-01[234]/);

    const realAction = { ...demoCorrectiveActions[0], title: "Acción real modificada" };
    const detail = renderToStaticMarkup(createElement(CorrectiveActionsModule, {
      actions: [realAction], onActionsChange: vi.fn(), session: activeSession,
    }));
    expect(detail).toContain("<h2>Root2Cause</h2>");
  });

  it("presenta estados vacíos en Revisión, Mejora y Formularios", () => {
    const review = renderToStaticMarkup(createElement(ManagementReviewModule, {
      records: [], onRecordsChange: vi.fn(), sources: {
        session: activeSession, documents: [], actions: [], assets: [], indicators: [], indicatorResults: {},
        supplierAudits: [], externalAudits: [], customers: [], suppliers: [], certifications: [],
        rncpSummary: { total: 0, closed: 0, late: 0, inProcess: 0 },
      },
    }));
    expect(review).toContain("No hay revisiones registradas");
    expect(review).not.toMatch(/RPD-202[45]-01/);

    const improvement = renderToStaticMarkup(createElement(ContinuousImprovementModule, {
      projects: [], onProjectsChange: vi.fn(), session: activeSession,
    }));
    expect(improvement).toContain("No hay proyectos registrados. Crea uno nuevo.");
    expect(improvement).not.toMatch(/MC-2026-00[123]/);

    const forms = normalizeAppForms(appFormCatalog.map(form => ({ ...form, records: [] })));
    const formHtml = renderToStaticMarkup(createElement(FormsModule, {
      forms, onFormsChange: vi.fn(), session: activeSession,
    }));
    expect(formHtml).not.toMatch(/REG-F-(VE|CA|TE)-/);
    expect(forms.every(form => form.records.length === 0)).toBe(true);
  });
});
