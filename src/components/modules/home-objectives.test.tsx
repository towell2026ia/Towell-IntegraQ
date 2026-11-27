import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { institutionalQualityObjectives } from "@/lib/home-objective-groups";
import { activeSession, type ActiveSession } from "@/lib/session-data";
import { HomeObjectives } from "./home-objectives";

it("shows only five full institutional objectives on Home", () => {
  const html = renderToStaticMarkup(<HomeObjectives />);
  expect(html.match(/<button\b/g)).toHaveLength(5);
  for (const objective of institutionalQualityObjectives) expect(html).toContain(objective);
  expect(html).not.toMatch(/IND-\d+|Sin objetivo asignado|Meta:|Sin resultado|indicadores en el alcance/i);
});

it("ofrece la política al lector documental de P-35 y respeta el alcance de la sesión", () => {
  const reader: ActiveSession = { ...activeSession, userType: "Usuario interno", authUserId: "reader",
    organizationId: "tenant", assignedProcessIds: ["P-35"], assignedModuleIds: ["documents"] };
  const render = (session: ActiveSession) => renderToStaticMarkup(<HomeObjectives session={session} />);
  expect(render(reader)).toContain("Consultar Política de Calidad");
  for (const changed of [{ assignedProcessIds: [] }, { assignedModuleIds: [] }, { organizationId: undefined },
    { userType: "Cliente" as const }, { userType: "Proveedor" as const }]) {
    expect(render({ ...reader, ...changed })).not.toContain("Consultar Política de Calidad");
  }
});
