"use client";
import { createClient } from "./supabase/client";
import type {
  Action,
  Command,
  Output,
  OutputContext,
  OutputEvent,
} from "./review-outputs";
const PAGE = 100;
export async function outputYears() {
  const { data, error } = await createClient().rpc("iq_re04_years");
  if (error) throw Error("No se pudieron consultar los períodos de acuerdos.");
  return data as number[];
}
export async function outputContext() {
  const { data, error } = await createClient().rpc("iq_re04_context");
  if (error || !data) throw Error("No se pudo abrir el registro de acuerdos.");
  return data as OutputContext;
}
export async function listOutputs(year: number) {
  const rows: Output[] = [];
  const client = createClient();
  let cursor: string | null = null;
  for (;;) {
    let query = client
      .from("management_review_decisions")
      .select("*")
      .not("origin_year", "is", null)
      .or(
        `origin_year.eq.${year},and(origin_year.lt.${year},auth_state.eq.authorized,execution.neq.completed),and(completed_at.gte.${year}-01-01,completed_at.lt.${year + 1}-01-02)`,
      )
      .order("id")
      .limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error)
      throw Error("No se pudieron consultar los acuerdos del período.");
    rows.push(...(data as Output[]));
    if (data.length < PAGE)
      return rows.sort(
        (a, b) =>
          b.origin_year - a.origin_year ||
          a.folio.localeCompare(b.folio, "es", { numeric: true }),
      );
    cursor = data[data.length - 1].id;
  }
}
async function detailRows(
  table: "review_output_actions" | "review_output_events",
  id: string,
  order: string,
) {
  const rows = [];
  for (let i = 0; ; i += PAGE) {
    const { data, error } = await createClient()
      .from(table)
      .select("*")
      .eq("decision_id", id)
      .order(order)
      .range(i, i + PAGE - 1);
    if (error) throw Error("No se pudo abrir el expediente.");
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}
export async function outputDetail(id: string) {
  const [actions, events] = await Promise.all([
    detailRows("review_output_actions", id, "id"),
    detailRows("review_output_events", id, "expected_revision"),
  ]);
  return { actions: actions as Action[], events: events as OutputEvent[] };
}
export async function references(
  search: string,
  minutes: boolean,
  year: number,
) {
  const { data, error } = await createClient().rpc("iq_re04_references", {
    p_search: search,
    p_minutes: minutes,
    p_year: year,
  });
  if (error) throw Error("No se pudieron consultar las referencias.");
  return data as { id: string; label: string }[];
}
export async function openOutputFile(id: string) {
  const client = createClient();
  const { data: file, error } = await client
    .from("file_objects")
    .select("bucket_id,object_path")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !file)
    throw Error("El documento no está disponible para esta sesión.");
  const result = await client.storage
    .from(file.bucket_id)
    .createSignedUrl(file.object_path, 60);
  if (result.error) throw Error("No se pudo abrir el documento.");
  const a = document.createElement("a");
  a.href = result.data.signedUrl;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.click();
}
export async function sendOutput(
  op: string,
  id: string,
  action: string | null,
  command: Command,
  revision: number,
  detail: Record<string, unknown>,
) {
  const { data, error } = await createClient().rpc("iq_re04_send", {
    p_operation: op,
    p_decision: id,
    p_action: action,
    p_command: command,
    p_revision: revision,
    p_detail: detail,
  });
  if (
    error?.code === "23505" &&
    error.message.includes("review_output_original_item")
  ) {
    throw Error(
      "Este acuerdo del acta ya está registrado. Consulta su folio en el año de origen.",
    );
  }
  if (error || data !== id)
    throw Error(
      error?.code === "23505" || error?.message.includes("RE04_CHANGED")
        ? "El acuerdo cambió. Cierra esta ventana para consultar la revisión actual."
        : "No se confirmó la operación. Revisa los datos, el estado y tus permisos antes de reintentar.",
    );
}
