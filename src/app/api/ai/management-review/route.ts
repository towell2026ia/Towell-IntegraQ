import { NextResponse } from "next/server";
import { getVerifiedSessionContext } from "@/lib/supabase/auth-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessModule } from "@/lib/access-policy";
import { isExternalUser } from "@/lib/session-data";
import {
  authorizeLegacyAiRequest,
  logLegacyAiRequest,
} from "@/ai/core/legacy-adapter";
import { aiCapabilityRegistry } from "@/ai/core/registry";
import { collectReview } from "@/lib/review-report-collector";
import { instructionVersion, validPeriod } from "@/lib/review-report";
import {
  generateReport,
  maxOutput,
  model,
  type Provider,
  reportSchema,
} from "@/ai/core/review-agent";

export const maxDuration = 30;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const failure = (error: string, status: number) => reply({ error }, status);
async function access() {
  const ctx = await getVerifiedSessionContext();
  if (ctx?.failure === "unavailable") {
    return failure("No se pudo verificar la sesión.", 503);
  }
  if (!ctx?.session) {
    return failure("Inicia sesión para consultar la revisión.", 401);
  }
  const { session, supabase } = ctx;
  if (
    isExternalUser(session) || session.workspaceMode !== "production" ||
    !session.authUserId || !session.organizationId ||
    !canAccessModule(session, "management-review")
  ) return failure("Sin acceso a esta revisión.", 403);
  const admin = session.userType === "Administrador" &&
    authorizeLegacyAiRequest(session, "management-review", "ai.generate_draft")
      .allowed;
  const director = await supabase.rpc("iq_re04_director");
  if (director.error) {
    return failure("No se pudieron verificar las atribuciones.", 503);
  }
  if (!admin && director.data !== true) {
    return failure("Sin acceso al expediente ejecutivo.", 403);
  }
  return { session, supabase, admin, director: director.data === true };
}
function configured() {
  return aiCapabilityRegistry.isEnabled("management.generate_review") &&
    !!process.env.OPENAI_API_KEY;
}
const provider: Provider = async (input) => {
  // Mismo SDK y secreto del servidor. Ningún reintento tras una respuesta incierta.
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://api.openai.com/v1",
    maxRetries: 0,
    timeout: 18000,
  });
  const result = await client.chat.completions.create({
    model,
    max_completion_tokens: maxOutput,
    store: false,
    messages: [{ role: "system", content: input.instructions }, {
      role: "user",
      content: input.message,
    }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "informe_anual",
        strict: true,
        schema: reportSchema,
      },
    },
  });
  const choice = result.choices[0];
  let body: unknown = null;
  if (choice?.finish_reason === "stop" && choice.message.content) {
    try {
      body = JSON.parse(choice.message.content);
    } catch { /* La validación registra el rechazo. */ }
  }
  return {
    body,
    input: result.usage?.prompt_tokens ?? null,
    output: result.usage?.completion_tokens ?? null,
  };
};
export async function GET(request: Request) {
  try {
    const ctx = await access();
    if (ctx instanceof Response) return ctx;
    const params = new URL(request.url).searchParams;
    const year = Number(params.get("year"));
    if (!validPeriod(year)) return failure("Período inválido.", 400);
    if (params.get("view") === "sources") {
      if (!ctx.admin) return failure("Sin acceso al recopilador.", 403);
      return reply(await collectReview(ctx.supabase, ctx.session, year));
    }
    const id = params.get("id");
    if (id) {
      if (!uuid.test(id)) return failure("Informe inválido.", 400);
      const q = await ctx.supabase.from("review_report_runs").select(
        "id,year,revision,state,snapshot,snapshot_hash,model,instructions,report,review_report_events(sequence,command,stage,actor,position_name,created_at,reason,conclusion,content_hash,proposal,decision_id)",
      ).eq("year", year).eq("organization_id", ctx.session.organizationId!).eq(
        "id",
        id,
      ).maybeSingle();
      if (q.error) return failure("El informe no está disponible.", 503);
      return q.data ? reply(q.data) : failure("Informe no disponible.", 404);
    }
    const runs = await ctx.supabase.from("review_report_runs").select(
      "id,revision,state,started_at,finished_at",
    ).eq("organization_id", ctx.session.organizationId!).eq("year", year).order(
      "started_at",
      { ascending: false },
    );
    if (runs.error) {
      return failure("El expediente central todavía no está disponible.", 503);
    }
    const budget = ctx.admin && configured()
      ? await ctx.supabase.rpc("iq_re05_available")
      : null;
    const visibleRuns = runs.data.map((r) =>
      r.state === "processing" &&
        Date.now() - Date.parse(r.started_at) > maxDuration * 1000
        ? { ...r, state: "uncertain" }
        : r
    );
    return reply({
      runs: visibleRuns,
      admin: ctx.admin,
      director: ctx.director,
      enabled: budget?.data === true &&
        !runs.data.some((r) => ["processing", "uncertain"].includes(r.state)),
    });
  } catch {
    return failure("No se pudo consultar la revisión.", 503);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await access();
    if (ctx instanceof Response) return ctx;
    const b = await request.json().catch(() => null);
    if (
      !b || !validPeriod(b.year) || !uuid.test(b.operation) ||
      typeof b.command !== "string"
    ) return failure("Solicitud de revisión inválida.", 400);
    if (b.command !== "generate") {
      if (
        !uuid.test(b.run) || !Number.isInteger(b.expected) ||
        typeof b.reason !== "string" || !b.reason.trim() ||
        !["edit", "submit", "validate", "authorize", "return", "proposal"]
          .includes(b.command)
      ) return failure("Comprueba los datos de la revisión.", 400);
      const q = await ctx.supabase.rpc("iq_re05_review", {
        p_id: b.operation,
        p_run: b.run,
        p_expected: b.expected,
        p_command: b.command,
        p_reason: b.reason,
        p_text: b.text ?? null,
        p_proposal: b.proposal ?? null,
      });
      if (q.error) {
        return failure(
          "No se confirmó el cambio. Comprueba tu permiso, el estado y la versión.",
          q.error.message.includes("DENIED") ? 403 : 409,
        );
      }
      return reply({ sequence: q.data });
    }
    if (!ctx.admin) return failure("Sin autorización para generar.", 403);
    if (!configured()) {
      return failure("Generación pendiente de configuración autorizada.", 403);
    }
    if (
      Object.keys(b).some((k) =>
        !["year", "operation", "command", "fingerprint", "accepted"].includes(k)
      ) || typeof b.accepted !== "boolean"
    ) return failure("Solicitud de generación inválida.", 400);
    const budget = await ctx.supabase.rpc("iq_re05_available");
    if (budget.data !== true) {
      return failure("Generación pendiente de presupuesto autorizado.", 403);
    }
    const snapshot = await collectReview(ctx.supabase, ctx.session, b.year);
    if (snapshot.fingerprint !== b.fingerprint) {
      return failure(
        "Las fuentes cambiaron. Consulta de nuevo el resumen.",
        409,
      );
    }
    const ledger = createAdminClient(); // Sólo escritura de la operación ya autorizada. Las fuentes usan el cliente de sesión.
    const operation = await generateReport(snapshot, b.accepted, true, {
      async reserve() {
        const q = await ledger.rpc("iq_re05_reserve", {
          p_id: b.operation,
          p_snapshot: snapshot,
          p_model: model,
          p_instructions: instructionVersion,
        });
        if (q.error) throw Error("No se pudo reservar la generación.");
        return q.data;
      },
      async finish(id, state, report, input, output) {
        const q = await ledger.rpc("iq_re05_finish", {
          p_id: id,
          p_state: state,
          p_report: report,
          p_input: input,
          p_output: output,
        });
        if (q.error) throw Error("No se confirmó el registro.");
      },
    }, provider);
    await logLegacyAiRequest({
      user: ctx.session,
      module: "management-review",
      capability: "management.generate_review",
      input: { operation: operation.id },
      context: { fingerprint: snapshot.fingerprint },
      status: operation.state === "completed"
        ? "success"
        : operation.state === "failed"
        ? "failed"
        : "processing",
      recordId: operation.id,
      recordType: "executive_report",
      model,
      provider: "openai",
      requiresApproval: true,
    });
    return reply(operation);
  } catch {
    return failure(
      "No se confirmó la operación. Consulta el expediente antes de reintentar.",
      503,
    );
  }
}
