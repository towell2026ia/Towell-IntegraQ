import { deriveLifecycle } from "./analytics";
import type { MatrixReport } from "./model";

export type NotificationEvent = "unattended" | "overdue" | "validation";
export interface PlannedNotification { event: NotificationEvent; occurrence: string; recipient: "inspector" | "supplier"; dedupeKey: string; reportId: string; }
export function planNotifications(report: MatrixReport, now: string): PlannedNotification[] {
  if (report.origin !== "native" || report.deletedAt || !report.notifiedAt) return [];
  const life = deriveLifecycle(report, now), events: Array<{ event: NotificationEvent; occurrence: string; recipients: PlannedNotification["recipient"][] }> = [];
  if (life.state === "closed") return [];
  if (!report.firstValidProgressAt && Date.parse(now) > Date.parse(report.notifiedAt) + 86_400_000) events.push({ event: "unattended", occurrence: report.notifiedAt, recipients: ["inspector", "supplier"] });
  if (life.timeliness === "late") events.push({ event: "overdue", occurrence: life.deadline!, recipients: ["inspector", "supplier"] });
  if (life.state === "validation" && report.completeSubmittedAt) events.push({ event: "validation", occurrence: report.completeSubmittedAt, recipients: ["inspector"] });
  return events.flatMap(({ event, occurrence, recipients }) => recipients.map(recipient => ({ event, occurrence, recipient, reportId: report.id,
    dedupeKey: JSON.stringify([report.id, event, occurrence, recipient]) })));
}
export interface VerifiedRecipient { userId?: string; email: string | null; confirmed: boolean; role: "inspector" | "supplier"; }
export function notificationTemplate(report: MatrixReport, event: NotificationEvent, now: string, siteUrl: string, recipient: "inspector" | "supplier" = "inspector") {
  const url = new URL(siteUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("URL de plataforma inválida.");
  url.pathname = "/"; url.search = new URLSearchParams({ rncp: report.id }).toString();
  url.hash = recipient === "supplier" ? "supplier-portal" : "suppliers";
  const days = report.notifiedAt ? Math.floor((Date.parse(now) - Date.parse(report.notifiedAt)) / 86_400_000) : null;
  const title = { unattended: "RNCP sin atención", overdue: "RNCP: incumplimiento del plazo de siete días", validation: "RNCP pendiente de validación de inspectormp" }[event];
  return { subject: `${title} · ${report.folio}`, text: [title, `Folio: ${report.folio}`, `Proveedor: ${report.supplierName}`,
    `Emisión: ${report.reportDate ?? "No registrada"}`, `Notificación: ${report.notifiedAt ?? "No registrada"}`,
    `Días transcurridos: ${days ?? "No verificables"}`, `Pendientes: ${report.missingRequirements.join(", ") || "Revisión de Calidad"}`,
    `Expediente (requiere sesión autorizada): ${url.href}`].join("\n") };
}
export interface DeliveryTransport { send(input: { recipient: string; subject: string; text: string; idempotencyKey: string }): Promise<{ messageId: string }>; }
export async function deliverPlanned(input: { authorized: boolean; recipient: VerifiedRecipient; key: string; template: { subject: string; text: string }; transport: DeliveryTransport | null }) {
  if (!input.authorized) return { status: "disabled" as const };
  if (!input.recipient.confirmed || !input.recipient.email) return { status: "pending_recipient" as const };
  if (!input.transport) return { status: "pending_configuration" as const };
  // Durable lease + unique key must be acquired by the repository before this call.
  const result = await input.transport.send({ recipient: input.recipient.email, ...input.template, idempotencyKey: input.key });
  return { status: "sent" as const, messageId: result.messageId };
}
