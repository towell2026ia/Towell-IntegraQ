import { describe, expect, it } from "vitest";

import {
  buildInitialImprovementProjects,
  buildProjectRoute,
  buildProjectScorecard,
  calculateProjectCompliance,
  calculateProjectRpmScore,
  calculateProjectScore,
  createImprovementProject,
  getImprovementProjectsForSession,
  normalizeImprovementProjects,
} from "@/lib/continuous-improvement-data";

describe("continuous improvement portfolio", () => {
  it("supports only Kaizen and DMAIC project routes", () => {
    expect(buildProjectRoute("kaizen", "2026-08-01", "2026-10-01")).toHaveLength(4);
    expect(buildProjectRoute("dmaic", "2026-08-01", "2026-12-01").map((phase) => phase.name)).toEqual([
      "Definir", "Medir", "Analizar", "Implementar", "Controlar",
    ]);
  });

  it("calculates the F-MC-002 RPM and compliance formulas", () => {
    const maximum = buildProjectScorecard({ impact: 7, implementationTime: 7, development: 8, implementation: 7, documentation: 7, training: 7 });
    expect(calculateProjectRpmScore(maximum)).toBe(7.2);
    expect(calculateProjectScore(maximum)).toBe(100);
    expect(calculateProjectCompliance(maximum)).toBe(100);
  });

  it("creates submitted projects in evaluation with a complete route", () => {
    const project = createImprovementProject({
      title: "Proyecto de prueba",
      type: "dmaic",
      category: "sgc",
      processId: "P-17",
      submittedBy: "Usuario",
      sponsor: "Dirección",
      leader: "Líder",
      problem: "Problema",
      objective: "Objetivo",
      scope: "Alcance",
      customer: "Cliente",
      metric: "%",
      baseline: "10",
      target: "5",
      startDate: "2026-08-01",
      targetDate: "2026-12-01",
      estimatedInvestment: 10,
      estimatedSavings: 100,
      team: [],
    }, 4);
    expect(project.code).toBe("MC-2026-004");
    expect(project.status).toBe("Abierto");
    expect(project.phases[0].status).toBe("active");
  });

  it("migrates saved projects from the former status and scorecard model", () => {
    const project = buildInitialImprovementProjects()[0];
    const migrated = normalizeImprovementProjects([{ ...project, status: "Activo", category: undefined, intakeSource: undefined, scorecard: [{ ...project.scorecard[0], id: "strategy" }] } as unknown as typeof project]);
    expect(migrated[0].status).toBe("En proceso");
    expect(migrated[0].category).toBe("kpi");
    expect(migrated[0].scorecard.map((criterion) => criterion.id)).toContain("impact");
  });

  it("consolidates legacy short improvements into the Kaizen route", () => {
    const project = buildInitialImprovementProjects()[2];
    const migrated = normalizeImprovementProjects([{ ...project, type: "quick" } as unknown as typeof project]);
    expect(migrated[0].type).toBe("kaizen");
    expect(migrated[0].phases).toHaveLength(4);
    expect(migrated[0].rapidImprovement).toBeDefined();
  });

  it("seeds the reference DMAIC project and a balanced portfolio", () => {
    const projects = buildInitialImprovementProjects();
    expect(projects.map((project) => project.type)).toEqual(["dmaic", "kaizen", "kaizen"]);
    expect(projects[0].metric).toContain("reprocesadas");
    expect(projects[0].phases[2].status).toBe("active");
  });

  it("limits submitters by ownership or process while managers see the complete portfolio", () => {
    const projects = buildInitialImprovementProjects();
    const submitter = {
      userId: "USR-TEJ",
      name: "Usuario de Tejido",
      shortName: "Usuario T.",
      initials: "UT",
      position: "Jefe de Tejido",
      department: "Operaciones",
      company: "Towell",
      userType: "Usuario interno" as const,
      assignedProcessIds: ["P-13"],
      continuousImprovementRole: "submitter" as const,
    };
    expect(getImprovementProjectsForSession(projects, submitter).map((project) => project.processId)).toEqual(["P-13"]);
    expect(getImprovementProjectsForSession(projects, { ...submitter, continuousImprovementRole: "manager" })).toHaveLength(3);
  });
});
