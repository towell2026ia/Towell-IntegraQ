import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeObjectives } from "./home-objectives";
import { HomeImageSlots } from "./home-image-slots";
import { buildHomeDashboard } from "@/lib/home-dashboard";
import { buildInitialIndicatorDefinitions } from "@/lib/indicator-data";
import { activeSession } from "@/lib/session-data";
describe("Home client presentation", () => {
  it("renders every authorized indicator, without truncating the list or inventing assignments", () => {
    const definitions = buildInitialIndicatorDefinitions();
    const dashboard = buildHomeDashboard({ session: activeSession, documents: [], actions: [], assets: [], indicators: definitions, indicatorResults: {}, supplierAudits: [], externalAudits: [] });
    const html = renderToStaticMarkup(createElement(HomeObjectives, { items: dashboard.qualityObjectives, onOpenIndicator: () => {} }));
    for (const definition of definitions) expect(html).toContain(definition.id + " · ");
    expect(html).toContain("52 indicadores");
    expect(html).toContain("5 objetivos con asignación");
    expect(html).toContain("Sin objetivo asignado");
  });
  it("renders all four slots for an authorized reader without showing edit controls", () => {
    const html = renderToStaticMarkup(createElement(HomeImageSlots, { administrator: false, editing: false }));
    for (const title of ["Política de Calidad", "Política Ambiental", "Política de Seguridad e Higiene", "Objetivos de Calidad"]) expect(html).toContain(title);
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Guardar imagen");
  });
});
