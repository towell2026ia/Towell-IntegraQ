import { NextResponse } from "next/server";

import {
  buildDefaultEvaluationRules,
  parseIndicatorMetric,
  quarters,
  type ConfiguredIndicator,
  type IndicatorResults,
  type Quarter,
} from "@/lib/indicator-data";
import type { IndicatorResultInput } from "@/lib/indicators/indicator-types";
import { DEFAULT_CAPTURE_DAYS_AFTER_CLOSE, INDICATOR_BUSINESS_TIME_ZONE } from "@/lib/indicators/indicator-windows";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { isAdministrator, isExternalUser } from "@/lib/session-data";
import { getAuthenticatedSession } from "@/lib/supabase/auth-session";
import { createClient } from "@/lib/supabase/server";

type RuntimeContext = {
  userId: string;
  workspaceId: string;
  workspaceMode: "demo" | "production";
  administrator: boolean;
};

async function resolveContext() {
  const session = await getAuthenticatedSession();
  if (!session?.authUserId) return { response: NextResponse.json({ error: "Sesión requerida." }, { status: 401 }) };
  if (isExternalUser(session)) {
    return { response: NextResponse.json({ error: "No cuentas con acceso al módulo de indicadores." }, { status: 403 }) };
  }
  const supabase = await createClient();
  const profile = await supabase.from("profiles")
    .select("organization_id,workspace_mode,status")
    .eq("id", session.authUserId)
    .maybeSingle();
  if (profile.error || !profile.data || profile.data.status !== "active" || !profile.data.organization_id) {
    return { response: NextResponse.json({ error: "La cuenta no tiene un espacio organizacional activo." }, { status: 409 }) };
  }
  return {
    context: {
      userId: session.authUserId,
      workspaceId: String(profile.data.organization_id),
      workspaceMode: profile.data.workspace_mode === "demo" ? "demo" as const : "production" as const,
      administrator: isAdministrator(session),
    } satisfies RuntimeContext,
    session,
    supabase,
  };
}

export async function GET() {
  try {
    const resolved = await resolveContext();
    if (resolved.response) return resolved.response;
    return NextResponse.json({
      ...await loadRuntimeSnapshot(resolved.supabase!, resolved.context!),
      access: {
        administrator: resolved.context!.administrator,
        assignedProcessIds: resolved.session!.assignedProcessIds,
        canUpdate: canPerformModuleAction(resolved.session!, "indicators", "update"),
        canView: canPerformModuleAction(resolved.session!, "indicators", "view"),
      },
    });
  } catch (error) {
    console.error("No fue posible consultar el runtime de indicadores.", error);
    return NextResponse.json({ error: "No fue posible consultar los indicadores." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const resolved = await resolveContext();
    if (resolved.response) return resolved.response;
    if (!resolved.context!.administrator) {
      return NextResponse.json({ error: "Sólo un administrador puede modificar indicadores." }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as { indicator?: ConfiguredIndicator } | null;
    if (!body?.indicator || !isConfiguredIndicator(body.indicator)) {
      return NextResponse.json({ error: "La definición del indicador no es válida." }, { status: 400 });
    }
    const indicator = body.indicator;
    const parsedRule = parseIndicatorMetric(indicator.metric);
    const periods = Object.entries(indicator.schedule).flatMap(([year, schedule]) =>
      quarters.map((quarter) => {
        const scheduledDate = schedule[quarter];
        const window = indicator.captureWindows?.[year]?.[quarter];
        return {
          year: Number(year),
          quarter,
          scheduledDate,
          opensAt: window?.opensAt ?? null,
          closesAt: window?.closesAt ?? null,
        };
      }),
    );
    if (periods.some((period) => {
      const opensAt = period.opensAt ? new Date(period.opensAt).getTime() : null;
      const closesAt = period.closesAt ? new Date(period.closesAt).getTime() : null;
      return !/^\d{4}-\d{2}-\d{2}$/.test(period.scheduledDate)
        || !Number.isInteger(period.year)
        || period.year < 2020
        || period.year > 2200
        || (opensAt === null) !== (closesAt === null)
        || (opensAt !== null && closesAt !== null && (
          !Number.isFinite(opensAt)
          || !Number.isFinite(closesAt)
          || opensAt > closesAt
        ));
    })) {
      return NextResponse.json({ error: "Las fechas o ventanas de captura no son válidas." }, { status: 400 });
    }
    const rules = indicator.evaluationRules ?? buildDefaultEvaluationRules(indicator.metric);
    const result = await resolved.supabase!.rpc("save_indicator_runtime", {
      requested_code: indicator.id,
      requested_source_row: indicator.sourceRow || null,
      requested_process_id: indicator.processId,
      requested_process_ids: indicator.processIds ?? [indicator.processId],
      requested_area: indicator.area,
      requested_direction_objective: indicator.directionObjective,
      requested_direction_metric: indicator.directionMetric,
      requested_quality_objective: indicator.qualityObjective,
      requested_name: indicator.name,
      requested_leader_name: indicator.leader,
      requested_metric_label: indicator.metric,
      requested_description: indicator.description,
      requested_rules: {
        ruleType: parsedRule.type,
        targetMin: parsedRule.min,
        targetMax: parsedRule.max,
        targetValue: parsedRule.target,
        marginalTolerancePercent: 5,
        unit: parsedRule.unit,
        compliant: rules.compliant,
        marginal: rules.marginal,
        noncompliant: rules.noncompliant,
      },
      requested_periods: periods,
    });
    if (result.error) return databaseError(result.error);
    return NextResponse.json({ id: String(result.data) });
  } catch (error) {
    console.error("No fue posible guardar el indicador.", error);
    return NextResponse.json({ error: "No fue posible guardar el indicador." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const resolved = await resolveContext();
    if (resolved.response) return resolved.response;
    if (!resolved.context!.administrator) {
      return NextResponse.json({ error: "Sólo un administrador puede modificar la configuración de captura." }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as { captureDaysAfterClose?: unknown } | null;
    if (!Number.isInteger(body?.captureDaysAfterClose)
      || Number(body?.captureDaysAfterClose) < 1
      || Number(body?.captureDaysAfterClose) > 90) {
      return NextResponse.json({ error: "Los días disponibles deben estar entre 1 y 90." }, { status: 400 });
    }
    const stored = await resolved.supabase!.from("indicator_capture_settings").upsert({
      organization_id: resolved.context!.workspaceId,
      workspace_mode: resolved.context!.workspaceMode,
      capture_days_after_close: Number(body!.captureDaysAfterClose),
      business_timezone: INDICATOR_BUSINESS_TIME_ZONE,
      updated_by: resolved.context!.userId,
    }, { onConflict: "organization_id,workspace_mode" });
    if (stored.error) return databaseError(stored.error);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("No fue posible actualizar la configuración de captura.", error);
    return NextResponse.json({ error: "No fue posible actualizar la configuración de captura." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const resolved = await resolveContext();
    if (resolved.response) return resolved.response;
    if (!resolved.context!.administrator) {
      return NextResponse.json({ error: "Sólo un administrador puede desactivar indicadores." }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as { indicatorId?: unknown } | null;
    if (typeof body?.indicatorId !== "string" || !body.indicatorId.trim()) {
      return NextResponse.json({ error: "Indicador inválido." }, { status: 400 });
    }
    const result = await resolved.supabase!.rpc("disable_indicator_runtime", { requested_code: body.indicatorId.trim() });
    if (result.error) return databaseError(result.error);
    return NextResponse.json({ id: String(result.data) });
  } catch (error) {
    console.error("No fue posible desactivar el indicador.", error);
    return NextResponse.json({ error: "No fue posible desactivar el indicador." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const resolved = await resolveContext();
    if (resolved.response) return resolved.response;
    if (!resolved.context!.administrator && !canPerformModuleAction(resolved.session!, "indicators", "update")) {
      return NextResponse.json({ error: "No tienes permiso para capturar resultados de este indicador." }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as IndicatorResultInput | null;
    if (!body || !isResultInput(body)) return NextResponse.json({ error: "Resultado inválido." }, { status: 400 });
    const definition = await resolved.supabase!.from("indicator_definitions")
      .select("id")
      .eq("organization_id", resolved.context!.workspaceId)
      .eq("workspace_mode", resolved.context!.workspaceMode)
      .eq("code", body.indicatorId)
      .eq("active", true)
      .maybeSingle();
    if (definition.error) return databaseError(definition.error);
    if (!definition.data) {
      return NextResponse.json({ error: "Este indicador no pertenece a uno de tus procesos asignados." }, { status: 403 });
    }
    const period = await resolved.supabase!.from("indicator_periods")
      .select("id,opens_at,closes_at")
      .eq("indicator_id", definition.data.id)
      .eq("year", body.year)
      .eq("quarter", body.quarter)
      .maybeSingle();
    if (period.error) return databaseError(period.error);
    if (!period.data) return NextResponse.json({ error: "El periodo de captura no está configurado." }, { status: 409 });
    const now = Date.now();
    const outsideWindow = now < new Date(period.data.opens_at).getTime()
      || now > new Date(period.data.closes_at).getTime();
    if (!resolved.context!.administrator && outsideWindow) {
      return NextResponse.json({ error: "El periodo de captura está cerrado. Consulta la fecha de apertura y cierre." }, { status: 409 });
    }
    if (resolved.context!.administrator && outsideWindow && !body.adminOverrideReason?.trim()) {
      return NextResponse.json({ error: "Indica el motivo de la modificación administrativa fuera de periodo." }, { status: 400 });
    }
    if (body.evidenceFileId) {
      const evidence = await resolved.supabase!.from("file_objects")
        .select("id")
        .eq("id", body.evidenceFileId)
        .eq("resource_type", "indicator_result")
        .eq("resource_key", `${body.indicatorId}:${body.year}:${body.quarter}`)
        .maybeSingle();
      if (evidence.error || !evidence.data) return NextResponse.json({ error: "La evidencia no pertenece a este resultado." }, { status: 400 });
    }
    const stored = await resolved.supabase!.rpc("save_indicator_result_runtime", {
      requested_period_id: period.data.id,
      requested_value: body.value,
      requested_comments: body.comments.trim() || null,
      requested_evidence_file_id: body.evidenceFileId || null,
      requested_override_reason: body.adminOverrideReason?.trim() || null,
    });
    if (stored.error) return databaseError(stored.error);
    const confirmation = stored.data as { submitted_at?: string } | null;
    return NextResponse.json({
      indicatorId: body.indicatorId,
      year: body.year,
      quarter: body.quarter,
      record: {
        value: body.value,
        comments: body.comments.trim(),
        evidenceFileId: body.evidenceFileId,
        adminOverrideReason: body.adminOverrideReason?.trim() || undefined,
        submittedAt: String(confirmation?.submitted_at ?? new Date().toISOString()),
        submittedBy: resolved.session!.name,
      },
    });
  } catch (error) {
    console.error("No fue posible guardar el resultado del indicador.", error);
    return NextResponse.json({ error: "No fue posible guardar el resultado." }, { status: 500 });
  }
}

async function loadRuntimeSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  context: RuntimeContext,
) {
  const settingsQuery = await supabase.from("indicator_capture_settings")
    .select("capture_days_after_close,business_timezone")
    .eq("organization_id", context.workspaceId)
    .eq("workspace_mode", context.workspaceMode)
    .maybeSingle();
  if (settingsQuery.error) throw settingsQuery.error;
  const settings = {
    captureDaysAfterClose: Number(settingsQuery.data?.capture_days_after_close ?? DEFAULT_CAPTURE_DAYS_AFTER_CLOSE),
    timezone: INDICATOR_BUSINESS_TIME_ZONE,
  } as const;
  const definitionsQuery = await supabase.from("indicator_definitions")
    .select("id,code,source_row,process_id,area,direction_objective,direction_metric,quality_objective,name,leader_name,owner_name_snapshot,metric_label,description,periodicity")
    .eq("organization_id", context.workspaceId)
    .eq("workspace_mode", context.workspaceMode)
    .eq("active", true)
    .order("code");
  if (definitionsQuery.error) throw definitionsQuery.error;
  const definitionRows = definitionsQuery.data ?? [];
  if (!definitionRows.length) return { definitions: [], results: {}, settings, loadedAt: new Date().toISOString(), source: "supabase" as const };
  const ids = definitionRows.map((row) => row.id);
  const [rulesQuery, relationsQuery, periodsQuery] = await Promise.all([
    supabase.from("indicator_evaluation_rules").select("indicator_id,compliant_rule,marginal_rule,noncompliant_rule").in("indicator_id", ids),
    supabase.from("indicator_definition_processes").select("indicator_id,process_id").in("indicator_id", ids),
    supabase.from("indicator_periods").select("id,indicator_id,year,quarter,scheduled_date,opens_at,closes_at").in("indicator_id", ids).order("year"),
  ]);
  if (rulesQuery.error) throw rulesQuery.error;
  if (relationsQuery.error) throw relationsQuery.error;
  if (periodsQuery.error) throw periodsQuery.error;
  const periodRows = periodsQuery.data ?? [];
  const resultQuery = periodRows.length
    ? await supabase.from("indicator_results")
      .select("period_id,value,comments,evidence_file_id,submitted_at,submitter:profiles!indicator_results_submitted_by_fkey(full_name),evidence:file_objects!indicator_results_evidence_file_id_fkey(original_name,size_bytes)")
      .in("period_id", periodRows.map((row) => row.id))
    : { data: [], error: null };
  if (resultQuery.error) throw resultQuery.error;
  const rulesByIndicator = new Map((rulesQuery.data ?? []).map((row) => [row.indicator_id, row]));
  const processesByIndicator = new Map<string, string[]>();
  for (const relation of relationsQuery.data ?? []) {
    processesByIndicator.set(relation.indicator_id, [...(processesByIndicator.get(relation.indicator_id) ?? []), relation.process_id]);
  }
  const periodsByIndicator = new Map<string, typeof periodRows>();
  for (const period of periodRows) {
    periodsByIndicator.set(period.indicator_id, [...(periodsByIndicator.get(period.indicator_id) ?? []), period]);
  }
  const definitionById = new Map(definitionRows.map((row) => [row.id, row]));
  const periodById = new Map(periodRows.map((row) => [row.id, row]));
  const results: IndicatorResults = {};
  for (const row of resultQuery.data ?? []) {
    const period = periodById.get(row.period_id);
    const definition = period ? definitionById.get(period.indicator_id) : undefined;
    if (!period || !definition) continue;
    const year = String(period.year);
    const quarter = period.quarter as Quarter;
    const evidence = relationRecord(row.evidence);
    results[definition.code] = {
      ...(results[definition.code] ?? {}),
      [year]: {
        ...(results[definition.code]?.[year] ?? {}),
        [quarter]: {
          value: Number(row.value),
          comments: row.comments || "",
          evidenceFileId: row.evidence_file_id || undefined,
          evidenceName: evidence?.original_name ? String(evidence.original_name) : undefined,
          evidenceSize: evidence?.size_bytes ? Number(evidence.size_bytes) : undefined,
          submittedAt: String(row.submitted_at),
          submittedBy: String(relationRecord(row.submitter)?.full_name || "Usuario IntegraQ"),
        },
      },
    };
  }
  const definitions: ConfiguredIndicator[] = definitionRows.map((row) => {
    const rule = rulesByIndicator.get(row.id);
    const periods = periodsByIndicator.get(row.id) ?? [];
    const schedule: ConfiguredIndicator["schedule"] = {};
    const captureWindows: NonNullable<ConfiguredIndicator["captureWindows"]> = {};
    for (const period of periods) {
      const year = String(period.year);
      const quarter = period.quarter as Quarter;
      schedule[year] = { ...(schedule[year] ?? {}) } as Record<Quarter, string>;
      schedule[year][quarter] = String(period.scheduled_date);
      captureWindows[year] = { ...(captureWindows[year] ?? {}) } as Record<Quarter, { opensAt: string; closesAt: string }>;
      captureWindows[year][quarter] = { opensAt: String(period.opens_at), closesAt: String(period.closes_at) };
    }
    return {
      id: row.code,
      sourceRow: Number(row.source_row || 0),
      processId: row.process_id,
      processIds: processesByIndicator.get(row.id) ?? [row.process_id],
      area: row.area,
      directionObjective: row.direction_objective || "",
      directionMetric: row.direction_metric || "",
      qualityObjective: row.quality_objective || "",
      name: row.name,
      leader: row.owner_name_snapshot || row.leader_name || "Sin responsable",
      metric: row.metric_label,
      period: row.periodicity === "quarterly" ? "Trimestral" : row.periodicity,
      description: row.description || "",
      evaluationRules: rule ? {
        compliant: rule.compliant_rule,
        marginal: rule.marginal_rule,
        noncompliant: rule.noncompliant_rule,
      } : buildDefaultEvaluationRules(row.metric_label),
      schedule,
      captureWindows,
    };
  });
  return { definitions, results, settings, loadedAt: new Date().toISOString(), source: "supabase" as const };
}

function relationRecord(value: unknown): Record<string, unknown> | null {
  const relation = Array.isArray(value) ? value[0] : value;
  return relation && typeof relation === "object" ? relation as Record<string, unknown> : null;
}

function isConfiguredIndicator(value: ConfiguredIndicator) {
  return Boolean(value.id?.trim() && value.name?.trim() && value.processId?.trim() && value.metric?.trim() && value.schedule && value.evaluationRules);
}

function isResultInput(value: IndicatorResultInput) {
  return Boolean(
    typeof value.indicatorId === "string" && value.indicatorId.trim()
    && Number.isInteger(value.year) && value.year >= 2020 && value.year <= 2200
    && quarters.includes(value.quarter)
    && typeof value.value === "number" && Number.isFinite(value.value)
    && typeof value.comments === "string"
    && (value.adminOverrideReason === undefined || typeof value.adminOverrideReason === "string")
  );
}

function databaseError(error: { code?: string; message?: string }) {
  const forbidden = error.code === "42501" || error.message?.includes("permission") || error.message?.includes("row-level security");
  if (error.message?.includes("INDICATOR_ADMIN_OVERRIDE_REASON_REQUIRED")) {
    return NextResponse.json({ error: "Indica el motivo de la modificación administrativa fuera de periodo." }, { status: 400 });
  }
  if (error.message?.includes("INDICATOR_EVIDENCE_INVALID")) {
    return NextResponse.json({ error: "La evidencia no pertenece a este resultado." }, { status: 400 });
  }
  if (error.message?.includes("INDICATOR_PROCESS_FORBIDDEN")) {
    return NextResponse.json({ error: "Este indicador no pertenece a uno de tus procesos asignados." }, { status: 403 });
  }
  if (error.message?.includes("INDICATOR_CAPTURE_PERMISSION_REQUIRED")) {
    return NextResponse.json({ error: "No tienes permiso para capturar resultados de este indicador." }, { status: 403 });
  }
  if (error.message?.includes("INDICATOR_CAPTURE_WINDOW_CLOSED") || error.message?.includes("fuera de la ventana")) {
    return NextResponse.json({ error: "El periodo de captura está cerrado. Consulta la fecha de apertura y cierre." }, { status: 409 });
  }
  return NextResponse.json(
    { error: forbidden ? "La operación no está autorizada para esta sesión." : "No fue posible completar la operación de indicadores." },
    { status: forbidden ? 403 : 409 },
  );
}
