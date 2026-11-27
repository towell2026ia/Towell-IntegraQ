import {
  blocksGeneration,
  instructions,
  type Report,
  reportSections,
  type Snapshot,
  validateReport,
} from "@/lib/review-report";

const string = { type: "string" };
const strings = { type: "array", items: string };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const list = (items: unknown) => ({ type: "array", items });
export const reportSchema = obj({
  sections: list(
    obj({
      title: { type: "string", enum: reportSections },
      text: string,
      references: strings,
    }),
  ),
  findings: list(obj({
    id: string,
    kind: { type: "string", enum: ["hecho", "inferencia", "recomendación"] },
    priority: { type: "string", enum: ["Alta", "Media", "Baja"] },
    text: string,
    justification: string,
    references: strings,
  })),
  risks: strings,
  recommendations: strings,
  proposals: list(
    obj({ id: string, finding: string, title: string, description: string }),
  ),
  limitations: strings,
  warnings: strings,
});
export const model = "gpt-4.1-mini-2025-04-14";
export const maxOutput = 4000;
export const maxInput = 24000;
export function agentInput(s: Snapshot) {
  // Sólo agregados y referencias internas a métricas. Todo registro nominal permanece en IntegraQ.
  const message = JSON.stringify({
    year: s.year,
    cutoff: s.cutoff,
    sections: reportSections,
    sources: s.sources.map(({ id, label, status, period, note, metrics }) => ({
      id,
      label,
      status,
      period,
      note,
      metrics,
    })),
  });
  if (
    Buffer.byteLength(
          message + instructions + JSON.stringify(reportSchema),
          "utf8",
        ) + 1024 > maxInput
  ) {
    throw Error("La información excede el límite autorizado.");
  }
  return {
    instructions: instructions +
      " Devuelve exactamente los quince apartados en el orden indicado. Usa identificadores F1… para hallazgos y P1… para propuestas.",
    message,
  };
}
export type Provider = (
  input: ReturnType<typeof agentInput>,
) => Promise<{ body: unknown; input: number | null; output: number | null }>;
type Reservation = { id: string; state: string; dispatch: boolean };
export type Ledger = {
  reserve: () => Promise<Reservation>;
  finish: (
    id: string,
    state: "completed" | "uncertain" | "failed",
    report: Report | null,
    input: number | null,
    output: number | null,
  ) => Promise<void>;
};
export async function generateReport(
  snapshot: Snapshot,
  accepted: boolean,
  authorized: boolean,
  ledger: Ledger,
  provider: Provider,
) {
  if (!authorized) {
    throw Error("Generación pendiente de configuración autorizada.");
  }
  if (
    snapshot.sources.some(blocksGeneration) ||
    (!accepted && snapshot.sources.some((s) => s.status !== "available"))
  ) {
    throw Error(
      "Revisa la disponibilidad y confirma las limitaciones del período.",
    );
  }
  const request = agentInput(snapshot);
  const reservation = await ledger.reserve();
  if (!reservation.dispatch) return reservation;
  let result: Awaited<ReturnType<Provider>>;
  try {
    result = await provider(request);
  } catch {
    await ledger.finish(reservation.id, "uncertain", null, null, null);
    throw Error("La generación requiere conciliación.");
  }
  let report: Report;
  try {
    report = validateReport(result.body, snapshot);
  } catch {
    await ledger.finish(
      reservation.id,
      "failed",
      null,
      result.input,
      result.output,
    );
    throw Error("El borrador no superó la validación.");
  }
  await ledger.finish(
    reservation.id,
    "completed",
    report,
    result.input,
    result.output,
  );
  return { id: reservation.id, state: "completed", dispatch: false };
}
