import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  session: vi.fn(), permission: vi.fn(), retrieve: vi.fn(), audit: vi.fn(),
  modelRetrieve: vi.fn(), responsesCreate: vi.fn(), clientOptions: [] as unknown[],
}));

vi.mock("openai", () => ({ default: class MockOpenAI {
  models = { retrieve: m.modelRetrieve };
  responses = { create: m.responsesCreate };
  constructor(options: unknown) { m.clientOptions.push(options); }
} }));
vi.mock("@/lib/supabase/auth-session", () => ({ getAuthenticatedSession: m.session }));
vi.mock("@/ai/core/legacy-adapter", () => ({ authorizeLegacyAiRequest: m.permission, logLegacyAiRequest: m.audit }));
vi.mock("@/lib/root2cause/context-server", () => ({ retrieveRootCauseDocuments: m.retrieve }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { GET, POST } from "./route";

const body = { mode: "step", step: 5, processId: "P-08", problem: "Desviación documentada de tensión del tejido", analysis: { rootCause: "" }, origin: "internal" };
const req = (value: unknown) => new Request("https://integraq.invalid/api/ai/root-cause/assist", { method: "POST", body: JSON.stringify(value) });
const modelOutput = (step = 5, fields: Record<string, unknown> = {}) => ({
  stages: [{ step, fields: { ...Object.fromEntries([
    "eventType", "severityJustification", "fiveW2H.what", "fiveW2H.why", "fiveW2H.where", "fiveW2H.when", "fiveW2H.who", "fiveW2H.how", "fiveW2H.howMuch",
    "brainstorm", "ishikawa.workforce", "ishikawa.machinery", "ishikawa.method", "ishikawa.material", "ishikawa.environment", "ishikawa.measurement",
    "nonDetectionCause", "rootCause", "nonDetectionWhys", "rootCauseWhys",
  ].map((key) => [key, ["brainstorm", "nonDetectionWhys", "rootCauseWhys", "ishikawa.workforce", "ishikawa.machinery", "ishikawa.method", "ishikawa.material", "ishikawa.environment", "ishikawa.measurement"].includes(key) ? [] : ""])), ...fields }, rationale: "Hipótesis por validar", missingData: [], references: [], actions: [] }], warnings: [],
});
const completedResponse = (output: unknown = modelOutput()) => ({
  id: "resp_test",
  status: "completed",
  output_text: JSON.stringify(output),
  output: [],
  usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165, input_tokens_details: { cached_tokens: 0 } },
});

beforeEach(() => {
  vi.unstubAllEnvs(); vi.clearAllMocks(); m.clientOptions.length = 0;
  m.session.mockResolvedValue({ authUserId: "user", userType: "Usuario interno" });
  m.permission.mockReturnValue({ allowed: true });
  m.retrieve.mockResolvedValue({ documents: [], warnings: [] });
  m.audit.mockResolvedValue(undefined);
  m.modelRetrieve.mockResolvedValue({ id: "gpt-5-nano" });
  m.responsesCreate.mockResolvedValue(completedResponse());
  vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "false");
  vi.stubEnv("OPENAI_API_KEY", "test-key-not-returned-to-client");
});

describe("Root2Cause GPT-5 nano endpoint", () => {
  it("checks account model access on the existing route without enabling generation or consuming tokens", async () => {
    const response = await GET(new Request("https://integraq.invalid/api/ai/root-cause/assist?processId=P-08"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ model: "gpt-5-nano", available: true, generationEnabled: false });
    expect(m.modelRetrieve).toHaveBeenCalledWith("gpt-5-nano");
    expect(m.responsesCreate).not.toHaveBeenCalled();
  });

  it("does not use another model when the read-only availability check is denied", async () => {
    m.modelRetrieve.mockRejectedValue({ status: 404 });
    const response = await GET(new Request("https://integraq.invalid/api/ai/root-cause/assist?processId=P-08"));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("gpt-5-nano");
    expect(m.responsesCreate).not.toHaveBeenCalled();
  });

  it("denies anonymous, external and unauthorized users before calling OpenAI", async () => {
    m.session.mockResolvedValueOnce(null);
    expect((await POST(req(body))).status).toBe(401);
    m.session.mockResolvedValueOnce({ authUserId: "supplier", userType: "Proveedor" });
    expect((await POST(req(body))).status).toBe(403);
    m.permission.mockReturnValue({ allowed: false });
    expect((await POST(req(body))).status).toBe(403);
    expect(m.modelRetrieve).not.toHaveBeenCalled();
    expect(m.responsesCreate).not.toHaveBeenCalled();
  });

  it("does not consume tokens while disabled or when the server key is missing", async () => {
    expect((await POST(req(body))).status).toBe(503);
    vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "true"); vi.stubEnv("OPENAI_API_KEY", "");
    expect((await POST(req(body))).status).toBe(503);
    expect(m.modelRetrieve).not.toHaveBeenCalled();
    expect(m.responsesCreate).not.toHaveBeenCalled();
  });

  it("uses only gpt-5-nano with Responses, structured output, no response storage, bounded output and idempotency", async () => {
    vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "true");
    const response = await POST(req(body));
    expect(response.status).toBe(200);
    expect(m.clientOptions[0]).toMatchObject({ apiKey: "test-key-not-returned-to-client", timeout: 45_000, maxRetries: 0 });
    expect(m.modelRetrieve).toHaveBeenCalledWith("gpt-5-nano");
    const [parameters, requestOptions] = m.responsesCreate.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(parameters).toMatchObject({ model: "gpt-5-nano", max_output_tokens: 8192, store: false });
    expect(parameters.text).toMatchObject({ format: { type: "json_schema", name: "root2cause_proposal", strict: true } });
    expect(requestOptions.idempotencyKey).toMatch(/^root2cause-[a-f0-9]{64}$/);
    const result = await response.json();
    expect(result.stages).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("test-key-not-returned-to-client");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai", model: "gpt-5-nano", status: "success",
      metadata: expect.objectContaining({ inputUnits: 120, outputUnits: 45, totalUnits: 165 }),
    }));
  });

  it("uses server-retrieved sources only and filters model references against them", async () => {
    vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "true");
    m.retrieve.mockResolvedValue({ documents: [{ id: "authorized", code: "P-08", title: "Procedimiento", type: "procedimiento", version: "2", excerpt: "Fragmento autorizado" }], warnings: [] });
    m.responsesCreate.mockResolvedValue(completedResponse(modelOutput(5, { rootCause: "Hipótesis", "fiveW2H.why": "razón" })));
    const response = await POST(req({ ...body, documents: [{ id: "forged", excerpt: "No autorizado" }] }));
    expect(response.status).toBe(200);
    const [parameters] = m.responsesCreate.mock.calls[0] as [Record<string, unknown>];
    expect(parameters.input).toContain("Fragmento autorizado");
    expect(parameters.input).not.toContain("No autorizado");
    expect((await response.json()).stages[0].references).toEqual([]);
    expect(m.retrieve).toHaveBeenCalledWith(expect.anything(), "P-08", expect.stringContaining("rootCause"), undefined);
  });

  it("includes the action type and verified-customer selection context without inventing a client", async () => {
    vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "true");
    const response = await POST(req({ ...body, origin: "customer" }));
    expect(response.status).toBe(200);
    const [parameters] = m.responsesCreate.mock.calls[0] as [Record<string, unknown>];
    expect(parameters.input).toContain('"correctiveActionType":"Externa"');
    expect(parameters.input).toContain('"customer":{"status":"no seleccionado"}');
  });

  it("checks model access before RAG/generation and never falls back when unavailable", async () => {
    vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "true");
    m.modelRetrieve.mockRejectedValue({ status: 404 });
    const response = await POST(req(body));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("gpt-5-nano");
    expect(m.retrieve).not.toHaveBeenCalled();
    expect(m.responsesCreate).not.toHaveBeenCalled();
  });

  it("fails closed when authorized document retrieval fails", async () => {
    vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "true"); m.retrieve.mockRejectedValue(new Error("RLS"));
    expect((await POST(req(body))).status).toBe(502);
    expect(m.responsesCreate).not.toHaveBeenCalled();
  });

  it("rejects a context exceeding the byte budget before a billable response call", async () => {
    vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "true");
    const response = await POST(req({ ...body, analysis: { oversized: "x".repeat(70_000) } }));
    expect(response.status).toBe(413);
    expect(m.responsesCreate).not.toHaveBeenCalled();
  });

  it("does not present incomplete or structurally invalid model output", async () => {
    vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "true");
    m.responsesCreate.mockResolvedValueOnce({ ...completedResponse(), status: "incomplete", output_text: "" });
    expect((await POST(req(body))).status).toBe(502);
    m.responsesCreate.mockResolvedValueOnce(completedResponse({ stages: [] }));
    expect((await POST(req(body))).status).toBe(502);
  });

  it("deduplicates identical concurrent calls and limits a different parallel request for the same user", async () => {
    vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "true");
    let finish!: (value: ReturnType<typeof completedResponse>) => void;
    m.responsesCreate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const first = POST(req(body));
    await vi.waitFor(() => expect(m.responsesCreate).toHaveBeenCalledTimes(1));
    const same = POST(req(body));
    const different = await POST(req({ ...body, problem: "Desviación distinta capturada en inspección" }));
    expect(different.status).toBe(429);
    finish(completedResponse());
    expect((await first).status).toBe(200);
    expect((await same).status).toBe(200);
    expect(m.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it("validates the optional customer id only for external actions", async () => {
    vi.stubEnv("ROOT2CAUSE_AI_ENABLED", "true");
    expect((await POST(req({ ...body, origin: "internal", relatedPartyId: "customer-id" }))).status).toBe(400);
  });
});
