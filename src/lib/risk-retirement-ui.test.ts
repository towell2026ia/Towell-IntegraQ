import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/components/modules/risks-opportunities-module.tsx"), "utf8");
const styles = readFileSync(join(process.cwd(), "src/components/modules/risks-opportunities.module.css"), "utf8");
const start = source.indexOf("function RiskMatrix(");
const end = source.indexOf("\n\nfunction AssessmentBadge", start);
const matrix = source.slice(start, end);

describe("RiskMatrix retirement control", () => {
  it("renders one right-edge icon with tooltip and accessible label, without visible Borrar text", () => {
    expect(matrix.match(/<Trash2\b/g) ?? []).toHaveLength(1);
    expect(matrix).toContain('title="Retirar riesgo"');
    expect(matrix).toContain('aria-label="Retirar riesgo"');
    expect(matrix).toContain("styles.riskActionsCell");
    expect(matrix).toContain("styles.riskRetireButton");
    expect(matrix).not.toContain(">Borrar</button>");
    expect(matrix).toContain("{canDelete ?");
    expect(styles).toContain(".riskActionsCell");
    expect(styles).toContain(".riskRetireButton:hover");
  });

  it("keeps confirmation, required reason, and persistent callback outside the visual control", () => {
    expect(source).toContain("window.confirm(");
    expect(source).toContain("Motivo obligatorio para retirar");
    expect(source).toContain("await onDeleteRisk(id, reason, kind)");
    expect(source).toContain("serverConnected && isAdministrator(session)");
  });
});
