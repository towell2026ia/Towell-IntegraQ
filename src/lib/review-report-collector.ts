import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canAccessModule } from "./access-policy";
import { authorize } from "./access/authorize";
import type { WorkspaceModuleId } from "./navigation";
import type { ActiveSession } from "./session-data";
import { getAssetDueStatus } from "./domain";
import { demoMeasurementAssets } from "./demo-data";
import type { MeasurementAsset } from "./types";
import { QUALITY_OBJECTIVES } from "./indicators/quality-objectives";
import { localDate, type Output, outputMetrics } from "./review-outputs";
import { rncpEffectiveness } from "./rncp/effectiveness";
import { qualityPolicyDocumentId } from "./home-institutional-images";
import {
  type Evidence,
  type Metric,
  type Snapshot,
  type Source,
  validPeriod,
} from "./review-report";

type TargetRule = {
  rule_type: string;
  target_value?: number;
  target_min?: number;
  target_max?: number;
  unit: string;
};
type Row = Record<string, unknown> & { id: string };
type Metrics = Omit<Metric, "id">[];
type Query = {
  order(
    column: string,
  ): {
    range(
      from: number,
      to: number,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
};
type Result = {
  records: string[];
  metrics: Metrics;
  note?: string;
  evidence?: Evidence[];
};
const count = (
  label: string,
  value: number,
  rule: string,
): Metrics[number] => ({ label, value, unit: "registros", rule });
function proportion(
  label: string,
  numerator: number,
  denominator: number,
  rule: string,
): Metrics[number] {
  return {
    label,
    value: denominator ? 100 * numerator / denominator : null,
    unit: "%",
    rule,
    numerator,
    denominator,
  };
}
async function rows(query: Query): Promise<Row[]> {
  const all: Row[] = [];
  const ordered = query.order("id");
  for (;;) {
    const { data, error } = await ordered.range(all.length, all.length + 199);
    if (error) throw error;
    const batch = data as unknown as Row[];
    all.push(...batch);
    if (batch.length < 200) return all;
  }
}
export async function collectReview(
  db: SupabaseClient,
  session: ActiveSession,
  year: number,
  now = new Date(),
): Promise<Snapshot> {
  const org = session.organizationId, actor = session.authUserId;
  if (
    !org || !actor || session.userType !== "Administrador" ||
    session.workspaceMode !== "production" || !validPeriod(year, now)
  ) throw Error("Acceso no disponible.");
  const cutoff = now.toISOString(),
    day = localDate(cutoff),
    start = year + "-01-01",
    end = day.startsWith(year + "-") ? day : year + "-12-31";
  const span = start + " a " + end, current = "Vigente al " + day;
  const tenant = (table: string, fields: string) =>
    db.from(table).select(fields).eq("organization_id", org);
  const result = (data: Row[], metrics: Metrics, note?: string): Result => ({
    records: data.map((r) => r.id),
    metrics,
    note,
  });
  const tasks: Promise<Source>[] = [];
  function source(
    id: string,
    label: string,
    module: WorkspaceModuleId,
    period: string,
    read: (() => Promise<Result>) | string,
  ) {
    tasks.push((async (): Promise<Source> => {
      const base = { id, label, period, metrics: [], records: [], note: "" };
      if (
        !canAccessModule(session, module) ||
        (module === "risks" &&
          !authorize({ user: session, permission: "risks.read" }).allowed)
      ) return { ...base, status: "forbidden" };
      if (typeof read === "string") {
        return { ...base, status: "pending", note: read };
      }
      try {
        const data = await read();
        return {
          ...base,
          status:
            !data.records.length && (!data.note || data.metrics.some((m) =>
                m.value === 0
              ))
              ? "empty"
              : data.note
              ? "partial"
              : "available",
          note: data.note ?? "",
          evidence: data.evidence,
          records: [...new Set(data.records)].sort().map((r) => id + ":" + r),
          metrics: data.metrics.map((m, i) => ({ ...m, id: id + "." + i })),
        };
      } catch (error) {
        const denied = typeof error === "object" && error !== null &&
          "code" in error && error.code === "42501";
        return {
          ...base,
          status: denied ? "forbidden" : "error",
          note: denied
            ? "Acceso restringido."
            : "La consulta requiere un nuevo intento.",
        };
      }
    })());
  }
  const scopedDocs = () =>
    tenant(
      "controlled_documents",
      "id,code,process_id,versions:controlled_document_versions(id,revision,status,updated_at)",
    ).eq("active", true).is("deleted_at", null);
  let documentRows: Promise<Row[]> | undefined;
  const documents = () => documentRows ??= rows(scopedDocs());
  type Version = {
    id: string;
    revision: number;
    status: string;
    updated_at: string;
  };
  source(
    "documents",
    "Información Documentada",
    "documents",
    current,
    async () => {
      const data = await documents();
      const changed = data.filter((r) =>
        (r.versions as Version[]).some((v) =>
          v.updated_at && localDate(v.updated_at) >= start &&
          localDate(v.updated_at) <= end
        )
      );
      const has = (r: Row, s: string) =>
        (r.versions as Version[]).some((v) => v.status === s);
      return result(
        data,
        [
          count(
            "Documentos vigentes",
            data.filter((r) => has(r, "current")).length,
            "Documentos con revisión vigente",
          ),
          count(
            "Pendientes de validación",
            data.filter((r) => has(r, "pending")).length,
            "Documentos con revisión pendiente",
          ),
          count(
            "Documentos con modificaciones en el período",
            changed.length,
            "Última modificación de al menos una versión dentro de " + span,
          ),
        ],
        "Los estados reflejan el corte actual. Las modificaciones se identifican por la fecha registrada de cada versión.",
      );
    },
  );
  for (
    const [id, label, documentId] of [[
      "manual",
      "Manual de Calidad",
      "b5b1c30d-da00-593c-abb7-15832857ef5c",
    ], ["policy", "Política de Calidad", qualityPolicyDocumentId]]
  ) {
    source(id, label, "documents", current, async () => {
      const record = (await documents()).find((r) =>
        r.id === documentId &&
        (id !== "manual" || r.code === "M-SGC-01" && r.process_id === "P-35")
      );
      const versions = (record?.versions as Version[] | undefined) ?? [];
      const version = versions.find((v) => v.status === "current") ??
        (id === "manual"
          ? versions.filter((v) => v.status === "pending").sort((a, b) =>
            b.revision - a.revision
          )[0]
          : undefined);
      return {
        records: version ? [documentId, version.id] : [],
        metrics: version
          ? [{
            label: version.status === "current"
              ? "Revisión vigente"
              : "Revisión en validación",
            value: version.revision,
            unit: "revisión",
            rule: "Versión del expediente oficial",
          }]
          : [],
      };
    });
  }
  for (
    const [id, label, table] of [[
      "organization",
      "Organización y puestos",
      "positions",
    ], ["processes", "Procesos", "processes"]]
  ) {
    source(id, label, id as WorkspaceModuleId, current, async () => {
      const fields = id === "organization"
        ? "id,name,parent_id"
        : "id,name,parent_id,process_owner_user_id";
      const data = await rows(tenant(table, fields).eq("active", true));
      return {
        ...result(
          data,
          [count(
            "Registros activos",
            data.length,
            "Catálogo autorizado al corte",
          )],
          "El catálogo acredita la estructura vigente. El desempeño anual se consulta en Indicadores.",
        ),
        evidence: data.map((r) => ({
          id: r.id,
          label: String(r.name),
          recordId: typeof r.parent_id === "string" ? r.parent_id : undefined,
          ownerId: typeof r.process_owner_user_id === "string"
            ? r.process_owner_user_id
            : undefined,
        })),
      };
    });
  }
  source(
    "risks",
    "Riesgos y oportunidades",
    "risks",
    "Ciclo " + year,
    async () => {
      const data = await rows(
        db.from("form_records").select(
          "id,values,form:form_definitions!inner(registration_number,process:processes!inner(organization_id))",
        ).eq("record_number", "RYO-WORKSPACE-2025").eq(
          "form.registration_number",
          "SYS-RYO-WORKSPACE-2025",
        ).eq("form.process.organization_id", org),
      );
      const metrics: Metrics = [];
      const ids: string[] = [];
      for (const row of data) {
        const s = row.values as {
          cycle: number;
          risks: {
            id: string;
            cycle: number;
            kind: string;
            treatment?: string;
            deletedAt?: string;
          }[];
          swotItems: { id: string; cycle: number; deletedAt?: string }[];
          actions?: { id: string; riskId: string; effectiveness: string }[];
        };
        const risks = s.risks.filter((r) => r.cycle === year && !r.deletedAt);
        const swot = s.swotItems.filter((item) =>
          item.cycle === year && !item.deletedAt
        );
        if (s.cycle !== year && !risks.length && !swot.length) continue;
        ids.push(row.id);
        const related = (s.actions ?? []).filter((a) =>
          risks.some((r) => r.id === a.riskId)
        );
        ids.push(...related.map((a) => a.id));
        metrics.push(
          count(
            "Oportunidades identificadas",
            risks.filter((r) => r.kind === "opportunity").length,
            "Oportunidades del ciclo de origen",
          ),
          count(
            "Riesgos y oportunidades con tratamiento",
            risks.filter((r) => r.treatment).length,
            "Tratamiento registrado para el ciclo",
          ),
          count(
            "Acciones con eficacia demostrada",
            related.filter((a) => a.effectiveness === "effective").length,
            "Eficacia registrada para las acciones de ese ciclo al corte",
          ),
        );
        for (
          const [label, items] of [[
            "Riesgos",
            risks.filter((r) => r.kind === "risk"),
          ], [
            "Elementos FODA",
            swot,
          ]] as const
        ) {
          const active = items.filter((x) => !x.deletedAt);
          ids.push(...active.map((x) => x.id));
          metrics.push(
            count(
              label,
              active.length,
              "Elementos activos del ciclo registrado",
            ),
          );
        }
      }
      return { records: ids, metrics };
    },
  );
  source(
    "objectives",
    "Objetivos e indicadores",
    "indicators",
    span,
    async () => {
      const data = await rows(
        db.from("indicator_periods").select(
          "id,quarter,indicator_id,scheduled_date,definition:indicator_definitions!inner(organization_id,code,process_id,quality_objective,metric_label,rule:indicator_evaluation_rules(rule_type,target_min,target_max,target_value,unit)),result:indicator_results(id,value,evaluation_status,evidence_file_id)",
        ).eq("definition.organization_id", org).eq(
          "definition.workspace_mode",
          "production",
        ).eq("year", year).lte("scheduled_date", end),
      );
      const metrics: Metrics = [];
      const refs: string[] = [];
      const evidence: Evidence[] = [];
      const byObjective = new Map<string, { evaluated: number; met: number }>();
      for (const quarter of ["Q1", "Q2", "Q3", "Q4"]) {
        const periods = data.filter((r) => r.quarter === quarter);
        const results = periods.flatMap((p) =>
          p.result ? [p.result].flat() : []
        ) as { id: string; value: number; evaluation_status: string }[];
        const captured = results.filter((r) =>
          r.value != null && Number.isFinite(Number(r.value))
        );
        const evaluated = captured.filter((r) =>
          ["compliant", "marginal", "noncompliant"].includes(
            r.evaluation_status,
          )
        );
        refs.push(...captured.map((r) => r.id));
        for (const p of periods) {
          const definition = p.definition as {
            code: string;
            process_id: string;
            quality_objective: string | null;
            metric_label: string;
            rule?: TargetRule | TargetRule[];
          };
          const measured = (Array.isArray(p.result) ? p.result[0] : p.result) as
            | {
              id: string;
              value: number;
              evaluation_status: string;
              evidence_file_id?: string;
            }
            | null;
          const rule = Array.isArray(definition.rule)
            ? definition.rule[0]
            : definition.rule;
          if (rule && !evidence.some((e) => e.recordId === p.indicator_id)) {
            for (
              const [field, label] of [["target_value", "Meta"], [
                "target_min",
                "Límite inferior",
              ], ["target_max", "Límite superior"]] as const
            ) {
              if (rule[field] != null) {
                evidence.push({
                  id: String(p.indicator_id) + ":" + field,
                  recordId: String(p.indicator_id),
                  label: label + " · " + definition.code,
                  value: rule[field],
                  unit: rule.unit || definition.metric_label,
                });
              }
            }
          }
          if (
            !measured || measured.value == null ||
            !Number.isFinite(Number(measured.value))
          ) continue;
          evidence.push({
            id: measured.id,
            fileId: measured.evidence_file_id ?? undefined,
            recordId: String(p.indicator_id),
            label: definition.code + " · " + quarter + " · " +
              definition.process_id,
            value: Number(measured.value),
            unit: rule?.unit || definition.metric_label,
            status: measured.evaluation_status,
            date: String(p.scheduled_date),
          });
          if (
            ["compliant", "marginal", "noncompliant"].includes(
              measured.evaluation_status,
            ) && QUALITY_OBJECTIVES.some((o) =>
              o === definition.quality_objective
            ) && definition.quality_objective
          ) {
            const tally = byObjective.get(definition.quality_objective) ??
              { evaluated: 0, met: 0 };
            tally.evaluated++;
            if (measured.evaluation_status === "compliant") {
              tally.met++;
            }
            byObjective.set(definition.quality_objective, tally);
          }
        }
        metrics.push(
          proportion(
            "Captura " + quarter,
            captured.length,
            periods.length,
            "Resultados capturados / períodos programados",
          ),
          proportion(
            "Metas " + quarter,
            evaluated.filter((r) => r.evaluation_status === "compliant").length,
            evaluated.length,
            "Resultados conformes / resultados evaluados",
          ),
          count(
            "Fuera de meta " + quarter,
            results.filter((r) => r.evaluation_status === "noncompliant")
              .length,
            "Evaluación registrada por Indicadores",
          ),
        );
      }
      for (const [objective, tally] of byObjective) {
        metrics.push(
          proportion(
            "Resultados en meta · " + objective,
            tally.met,
            tally.evaluated,
            "Resultados conformes entre capturas evaluadas vinculadas al objetivo",
          ),
        );
      }
      const resultsByIndicator = new Map<string, Evidence[]>();
      for (const item of evidence) {
        if (!item.date) continue;
        const id = item.recordId!;
        const same = resultsByIndicator.get(id) ?? [];
        same.push(item);
        resultsByIndicator.set(id, same);
      }
      const changes = { up: 0, down: 0, flat: 0 };
      for (const series of resultsByIndicator.values()) {
        series.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
        if (series.length < 2) continue;
        const delta = series.at(-1)!.value! - series.at(-2)!.value!;
        changes[delta > 0 ? "up" : delta < 0 ? "down" : "flat"]++;
      }
      for (
        const [key, label] of [["up", "Aumento"], ["down", "Descenso"], [
          "flat",
          "Sin variación",
        ]] as const
      ) {
        metrics.push(
          count(
            label + " en la última medición",
            changes[key],
            "Variación entre dos resultados del mismo indicador; la dirección del cambio no equivale a cumplimiento",
          ),
        );
      }
      return {
        records: [...data.map((r) => r.id), ...refs],
        metrics,
        evidence,
      };
    },
  );
  source(
    "customers",
    "Reclamaciones de clientes",
    "customers",
    span,
    async () => {
      const data = await rows(
        db.from("quality_cases").select(
          "id,status,external_organization_id,customer:organizations!quality_cases_external_organization_id_fkey!inner(owning_organization_id)",
        ).eq("customer.owning_organization_id", org).eq("kind", "claim").is(
          "cancelled_at",
          null,
        ).gte("received_at", start).lte("received_at", end),
      );
      const counts = new Map<string, number>();
      for (const r of data) {
        const key = String(r.external_organization_id);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return result(data, [
        count(
          "Reclamaciones recibidas",
          data.length,
          "Fecha de recepción del expediente",
        ),
        count(
          "Clientes con más de una reclamación",
          [...counts.values()].filter((n) => n > 1).length,
          "Agrupación por cliente dentro del período",
        ),
      ], "La reiteración por cliente no establece una causa común.");
    },
  );
  source("suppliers", "Calidad de proveedores", "suppliers", span, async () => {
    const data = await rows(
      tenant(
        "supplier_rncp_reports",
        "id,status,source_kind,historical_status,validation_outcome,notified_at,response_deadline,complete_submitted_at,validated_at",
      ).is("deleted_at", null).gte("report_date", start).lte(
        "report_date",
        end,
      ),
    );
    const text = (v: unknown) => typeof v === "string" ? v : undefined;
    const e = rncpEffectiveness(
      data.map((r) => ({
        id: r.id,
        status: text(r.status),
        origin: text(r.source_kind),
        historicalStatus: text(r.historical_status),
        validationOutcome: text(r.validation_outcome),
        notifiedAt: text(r.notified_at),
        responseDeadline: text(r.response_deadline),
        completeSubmittedAt: text(r.complete_submitted_at),
        validatedAt: text(r.validated_at),
      })),
      now.getTime(),
    );
    const audits = await rows(
      tenant("supplier_audit_events", "id").eq("calendar_year", year).is(
        "withdrawn_at",
        null,
      ),
    );
    const evaluations = await rows(
      db.from("supplier_assessments").select(
        "id,score,assessment_date,assessment_type,supplier:organizations!supplier_assessments_supplier_id_fkey!inner(owning_organization_id)",
      ).eq("supplier.owning_organization_id", org).gte("assessment_date", start)
        .lte("assessment_date", end),
    );
    return {
      ...result([...data, ...audits, ...evaluations], [
        count("RNCP", data.length, "Fecha oficial de emisión"),
        proportion(
          "Efectividad RNCP",
          e.closed,
          e.evaluable,
          "Cerrados / (cerrados + tardíos) según el expediente al corte",
        ),
        count(
          "Auditorías programadas del año",
          audits.length,
          "Programa activo",
        ),
        count(
          "Evaluaciones registradas",
          evaluations.length,
          "Fecha de evaluación",
        ),
      ]),
      evidence: evaluations.map((r) => ({
        id: r.id,
        date: String(r.assessment_date),
        label: "Evaluación del proveedor",
        value: typeof r.score === "number" ? r.score : undefined,
      })),
    };
  });
  source(
    "root2cause",
    "Acciones correctivas",
    "corrective-actions",
    span,
    async () => {
      const data = await rows(
        tenant(
          "corrective_actions",
          "id,status,due_date,created_at,iq_u08_case_visible",
        ).eq("iq_u08_case_visible", true).is("deleted_at", null),
      );
      const period = data.filter((r) => {
        const d = localDate(String(r.created_at));
        return d >= start && d <= end;
      });
      const closed = period.filter((r) => r.status === "closed");
      const efficacy = await rows(
        db.from("corrective_action_effectiveness_reviews").select(
          "id,result,reviewed_at,action:corrective_actions!inner(organization_id,iq_u08_case_visible,deleted_at)",
        ).eq("action.organization_id", org).eq(
          "action.iq_u08_case_visible",
          true,
        ).is("action.deleted_at", null),
      );
      const reviewed = efficacy.filter((r) => {
        const d = localDate(String(r.reviewed_at));
        return d >= start && d <= end;
      });
      return result(
        [...period, ...reviewed],
        [
          count(
            "Eficacia demostrada",
            reviewed.filter((r) => r.result === "effective").length,
            "Validaciones con resultado eficaz durante el período",
          ),
          count(
            "A3 abiertos al corte",
            period.filter((r) => r.status !== "closed").length,
            "Expedientes originados en el período actualmente abiertos",
          ),
          count("A3 originados", period.length, "Fecha local de registro"),
          count(
            "Cerrados al corte",
            closed.length,
            "Estado actual del expediente",
          ),
          count(
            "Vencidos al corte",
            period.filter((r) =>
              r.status !== "closed" && r.status !== "cancelled" &&
              typeof r.due_date === "string" && r.due_date < day
            ).length,
            "Fecha compromiso anterior al corte sin cierre",
          ),
        ],
        "La condición actual de cierre no acredita eficacia ni estado histórico al fin de año.",
      );
    },
  );
  source("calibrations", "Calibraciones", "calibrations", current, async () => {
    const data = await rows(
      db.from("form_records").select(
        "id,assets:values->assets,form:form_definitions!inner(registration_number,process:processes!inner(organization_id))",
      ).eq("record_number", "METROLOGY-WORKSPACE").eq(
        "form.registration_number",
        "SYS-METROLOGY-WORKSPACE",
      ).eq("form.process.organization_id", org),
    );
    const seedIds = new Set(demoMeasurementAssets.map((a) => a.id));
    const all = data.flatMap((r) => {
      if (!Array.isArray(r.assets)) throw Error("EXPEDIENTE");
      return r.assets as MeasurementAsset[];
    });
    const assets = all.filter((a) => !seedIds.has(a.id));
    return {
      records: assets.map((a) => a.id),
      metrics: assets.length || all.length === 0
        ? [
          count(
            "Equipos controlados",
            assets.length,
            "Inventario central identificable",
          ),
          count(
            "Equipos vencidos",
            assets.filter((a) => getAssetDueStatus(a, day) === "overdue")
              .length,
            "Vigencia oficial de Metrología al corte",
          ),
          count(
            "Próximos a vencer",
            assets.filter((a) => getAssetDueStatus(a, day) === "due_soon")
              .length,
            "Ventana de Metrología",
          ),
        ]
        : [],
      note: assets.length !== all.length
        ? "Equipos con identidad de muestra excluidos hasta conciliación."
        : undefined,
    };
  });
  for (
    const [id, label] of [["audits", "Auditorías"], [
      "continuous-improvement",
      "Mejora continua",
    ]]
  ) {
    source(
      id,
      label,
      id as WorkspaceModuleId,
      span,
      "El módulo conserva información del navegador. Falta una consolidación anual central verificable.",
    );
  }
  for (
    const [id, label, type] of [[
      "previous",
      "Actas de revisiones anteriores",
      "management_review_minutes",
    ], [
      "attachments",
      "Documentación complementaria",
      "management_review_document",
    ]]
  ) {
    source(id, label, "management-review", span, async () => {
      const files = (select: string) =>
        db.from("file_objects").select(select).eq(
          "module_id",
          "management-review",
        ).eq("resource_type", type).like(
          "resource_key",
          id === "previous" ? String(year) : year + ":%",
        ).eq("is_current", true).is("deleted_at", null);
      const [scoped, legacy] = await Promise.all([
        rows(files("id,version").eq("workspace_id", org)),
        rows(
          files(
            "id,version,uploader:profiles!file_objects_uploaded_by_fkey!inner(organization_id)",
          ).is("workspace_id", null).eq("uploader.organization_id", org),
        ),
      ]);
      const data = [...scoped, ...legacy];
      return result(data, [
        count(
          "Archivos autorizados",
          data.length,
          "Referencias vigentes del expediente anual",
        ),
      ]);
    });
  }
  let decisionRows: Promise<Row[]> | undefined;
  const decisions = () =>
    decisionRows ??= rows(
      tenant(
        "management_review_decisions",
        "id,folio,origin_year,auth_state,execution,due_date,completed_at,agreement_date,owner_id,classification,review_output_actions(id,owner_id,progress,state,due,actual,file_id)",
      ).lte("origin_year", year).lte("agreement_date", end),
    );
  source(
    "outputs",
    "Salidas de revisión",
    "management-review",
    span,
    async () => {
      const data = await decisions();
      const visible = data.filter((r) =>
        r.origin_year === year ||
        r.auth_state === "authorized" &&
          (r.execution !== "completed" ||
            r.completed_at &&
              localDate(String(r.completed_at)).startsWith(year + "-"))
      );
      const evidence: Evidence[] = [];
      for (const d of visible) {
        evidence.push({
          id: d.id,
          label: String(d.folio),
          date: String(d.agreement_date),
          status: String(d.auth_state) + "/" + String(d.execution),
          ownerId: typeof d.owner_id === "string" ? d.owner_id : undefined,
        });
        for (
          const a of (d.review_output_actions ?? []) as {
            id: string;
            owner_id: string;
            progress: number;
            state: string;
            due: string;
            actual: string | null;
            file_id: string | null;
          }[]
        ) {
          evidence.push({
            id: a.id,
            recordId: d.id,
            actionId: a.id,
            ownerId: a.owner_id,
            label: String(d.folio),
            date: a.actual ?? a.due,
            status: a.state,
            value: a.progress,
            unit: "%",
            fileId: a.file_id ?? undefined,
          });
        }
      }
      const m = outputMetrics(data as unknown as Output[], year, day);
      return {
        ...result(visible, [
          count("Autorizados", m.authorized, "Año de origen"),
          count(
            "Pendientes anteriores",
            m.previous,
            "Autorizados de años anteriores aún pendientes al corte",
          ),
          count(
            "Vencidos",
            m.overdue,
            "Acuerdos del período vencidos al corte",
          ),
          proportion(
            "Cumplimiento",
            m.closed,
            m.authorized,
            "Concluidos y validados / autorizados evaluables",
          ),
        ]),
        evidence,
      };
    },
  );
  source(
    "satisfaction",
    "Satisfacción del cliente",
    "customers",
    span,
    "Encuestas sin una fuente anual integrada.",
  );
  source("resources", "Recursos", "management-review", span, async () => {
    const needs = (await decisions()).filter((r) =>
      r.origin_year === year && r.auth_state === "authorized" &&
      r.classification === "resources"
    );
    return result(
      needs,
      [count(
        "Necesidades de recursos autorizadas",
        needs.length,
        "Acuerdos autorizados de la categoría Recursos",
      )],
      "Las decisiones documentan necesidades. Falta una fuente verificable de disponibilidad.",
    );
  });
  const sources = await Promise.all(tasks);
  const fingerprint = createHash("sha256").update(
    JSON.stringify({ org, year, sources }),
  ).digest("hex");
  return {
    organization: org,
    organizationName: session.company,
    actor,
    year,
    cutoff,
    fingerprint,
    sources,
  };
}
