import { describe, expect, it, vi } from "vitest";
import {
  agentInput,
  generateReport,
  type Ledger,
} from "@/ai/core/review-agent";
import {
  renderNarrative,
  type Report,
  reportSections,
  type Snapshot,
  validateReport,
  validPeriod,
} from "./review-report";

const source: Snapshot = {
  organization: "tenant",
  actor: "private-user",
  year: 2025,
  cutoff: "2025-12-31T12:00:00Z",
  fingerprint: "a".repeat(64),
  sources: [{
    id: "outputs",
    label: "Salidas",
    status: "available",
    period: "2025",
    note: "",
    records: ["outputs:private-record"],
    metrics: [{
      id: "outputs.0",
      label: "Autorizados",
      value: 3,
      unit: "acuerdos",
      rule: "Autorización",
    }],
  }],
};
const draft: Report = {
  sections: reportSections.map((title) => ({
    title,
    text: "El conteo es {{outputs.0}}.",
    references: ["outputs.0"],
  })),
  findings: [{
    id: "F1",
    kind: "hecho",
    priority: "Media",
    text: "Hay acuerdos.",
    justification: "Registro oficial.",
    references: ["outputs"],
  }],
  risks: [],
  recommendations: [],
  proposals: [],
  limitations: [],
  warnings: [],
};
function setup() {
  const ledger: Ledger = {
    reserve: vi.fn(async () => ({
      id: "op",
      state: "processing",
      dispatch: true,
    })),
    finish: vi.fn(async () => {}),
  };
  const provider = vi.fn(async () => ({ body: draft, input: 100, output: 40 }));
  return { ledger, provider };
}
describe("Informe oficial de Revisión por la Dirección", () => {
  it("aplica la zona institucional y rechaza períodos futuros", () => {
    const now = new Date("2026-01-01T03:00:00Z");
    expect(validPeriod(2025, now)).toBe(true);
    expect(validPeriod(2026, now)).toBe(false);
    expect(validPeriod("2025", now)).toBe(false);
  });
  it("excluye identidad y referencias privadas del mensaje al proveedor", () => {
    const body = agentInput(source).message;
    expect(body).not.toContain("private-user");
    expect(body).not.toContain("private-record");
    expect(body).toContain("outputs.0");
  });
  it("admite sólo el esquema completo y cifras resueltas desde la fotografía", () => {
    expect(validateReport(draft, source)).toEqual(draft);
    expect(renderNarrative(draft.sections[0].text, source)).toContain(
      "3 acuerdos",
    );
    for (
      const text of [
        "Logramos 97 %.",
        "{{outputs.99}}",
        "<script>",
        "",
        "{{outputs.0}} 100",
      ]
    ) {
      const changed = structuredClone(draft);
      changed.sections[0].text = text;
      expect(() => validateReport(changed, source)).toThrow();
    }
    expect(() => validateReport({ ...draft, extra: true }, source)).toThrow();
    const changed = structuredClone(draft);
    changed.findings[0].references = ["otra"];
    expect(() => validateReport(changed, source)).toThrow();
  });
  it.each(["partial", "pending", "empty", "forbidden"] as const)(
    "requiere aceptar una fuente %s",
    async (status) => {
      const { ledger, provider } = setup(),
        partial = { ...source, sources: [{ ...source.sources[0], status }] };
      await expect(generateReport(partial, false, true, ledger, provider))
        .rejects.toThrow();
      expect(ledger.reserve).not.toHaveBeenCalled();
      await generateReport(partial, true, true, ledger, provider);
      expect(provider).toHaveBeenCalledOnce();
    },
  );
  it("impide consumir con error o sin autorización", async () => {
    const { ledger, provider } = setup();
    await expect(generateReport(source, true, false, ledger, provider)).rejects
      .toThrow();
    await expect(
      generateReport(
        { ...source, sources: [{ ...source.sources[0], status: "error" }] },
        true,
        true,
        ledger,
        provider,
      ),
    ).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
    expect(ledger.reserve).not.toHaveBeenCalled();
  });
  it("reserva antes de generar y conserva consumo aunque el informe sea inválido", async () => {
    const { ledger, provider } = setup();
    await generateReport(source, false, true, ledger, provider);
    expect(ledger.finish).toHaveBeenCalledWith(
      "op",
      "completed",
      draft,
      100,
      40,
    );
    await expect(
      generateReport(
        source,
        false,
        true,
        ledger,
        async () => ({ body: {}, input: 12, output: 3 }),
      ),
    ).rejects.toThrow();
    expect(ledger.finish).toHaveBeenCalledWith("op", "failed", null, 12, 3);
  });
  it("recupera sin repetir llamadas una operación incierta o completada", async () => {
    const { ledger, provider } = setup();
    provider.mockRejectedValueOnce(Error());
    await expect(generateReport(source, false, true, ledger, provider)).rejects
      .toThrow();
    expect(ledger.finish).toHaveBeenCalledWith(
      "op",
      "uncertain",
      null,
      null,
      null,
    );
    for (const state of ["uncertain", "completed", "processing"]) {
      ledger.reserve = async () => ({ id: "op", state, dispatch: false });
      expect((await generateReport(source, false, true, ledger, provider)).id)
        .toBe("op");
    }
    expect(provider).toHaveBeenCalledOnce();
  });
});
