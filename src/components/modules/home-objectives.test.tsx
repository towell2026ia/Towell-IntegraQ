import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { institutionalQualityObjectives } from "@/lib/home-objective-groups";
import { HomeObjectives } from "./home-objectives";

it("shows only five full institutional objectives on Home", () => {
  const html = renderToStaticMarkup(<HomeObjectives />);
  expect(html.match(/<button\b/g)).toHaveLength(5);
  for (const objective of institutionalQualityObjectives) expect(html).toContain(objective);
  expect(html).not.toMatch(/IND-\d+|Sin objetivo asignado|Meta:|Sin resultado|indicadores en el alcance/i);
});
