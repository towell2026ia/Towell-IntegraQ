import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CorrectiveActionsModule } from "@/components/modules/corrective-actions-module";
import { ContinuousImprovementModule } from "@/components/modules/continuous-improvement-module";
import { FormsModule } from "@/components/modules/forms-module";
import { ManagementReviewModule } from "@/components/modules/management-review-module";
import { demoCorrectiveActions, restoreInitialCorrectiveActions } from "@/lib/demo-data";
import { appFormCatalog, normalizeAppForms } from "@/lib/form-data";
import { editableModulePermissionGroups } from "@/lib/module-permissions";
import { workspaceModuleMeta } from "@/lib/navigation";
import { activeSession } from "@/lib/session-data";

describe("dashboard Root2Cause y módulos vacíos", () => {
  it("restaura las cuatro pestañas incluso sin registros visibles", () => {
    expect(workspaceModuleMeta["corrective-actions"].label).toBe("Root2Cause");
    expect(editableModulePermissionGroups.find(group => group.moduleId === "corrective-actions")?.label).toBe("Root2Cause");
    const html = renderToStaticMarkup(createElement(CorrectiveActionsModule, {
      actions: [], onActionsChange: vi.fn(), session: activeSession,
    }));
    expect(html).toContain("<h2>Root2Cause</h2>");
    for (const tab of ["Acciones abiertas", "Externas / clientes", "Internas", "Sistema de gestión"]) expect(html).toContain(tab);
    expect(html).toContain("Buscar acción");
    expect(html).toContain("Filtrar por estado");
    expect(html).toContain("Sin acciones en este listado");
    expect(html).toContain("Acciones activas");

    const restored = restoreInitialCorrectiveActions([]);
    expect(restored.map(action => action.folio)).toEqual(demoCorrectiveActions.map(action => action.folio));
    const detail = renderToStaticMarkup(createElement(CorrectiveActionsModule, {
      actions: restored, onActionsChange: vi.fn(), session: activeSession,
    }));
    expect(detail).toContain("<h2>Root2Cause</h2>");
    expect(detail).toContain("AC-2026-014");
    expect(detail).toContain("Externas / clientes");
  });

  it("shows the four Root2Cause lists to internal viewers without write controls", () => {
    const viewer = { ...activeSession, userType: "Usuario interno" as const, organizationId: "org-a",
      assignedProcessIds: ["P-13"], assignedModuleIds: ["corrective-actions" as const],
      moduleActionPermissions: [{ moduleId: "corrective-actions" as const, action: "view" as const }] };
    const action = { ...demoCorrectiveActions[0], organizationId: "org-a", processId: "P-13", participantUserIds: [] };
    const html = renderToStaticMarkup(createElement(CorrectiveActionsModule, {
      actions: [action], onActionsChange: vi.fn(), session: viewer,
    }));
    for (const tab of ["Acciones abiertas", "Externas / clientes", "Internas", "Sistema de gestión"]) expect(html).toContain(tab);
    expect(html).toContain(action.folio);
    expect(html).toContain("Buscar acción");
    expect(html).not.toContain("Iniciar análisis A3");
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
