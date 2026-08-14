"use client";

import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  GitBranch,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AiSuggestionResult } from "@/components/modules/ai-suggestion-result";
import { buildRootCauseAiRequest } from "@/lib/ai-context";
import { customerQualityCatalog } from "@/lib/quality-parties-data";
import type {
  A3Analysis,
  AiRootCauseDraft,
  CorrectiveActionSeverity,
  CorrectiveActionSource,
} from "@/lib/types";

export interface A3Submission {
  title: string;
  problem: string;
  source: CorrectiveActionSource;
  severity: CorrectiveActionSeverity;
  area: string;
  owner: string;
  dueDate: string;
  relatedParty?: string;
  a3: A3Analysis;
  aiDraft?: AiRootCauseDraft;
}

interface A3Draft {
  origin: "customer" | "internal" | "system";
  eventType: string;
  relatedParty: string;
  title: string;
  problem: string;
  area: string;
  owner: string;
  dueDate: string;
  severity: CorrectiveActionSeverity;
  severityJustification: string;
  fiveW2H: A3Analysis["fiveW2H"];
  brainstorm: string[];
  ishikawa: A3Analysis["ishikawa"];
  nonDetectionCause: string;
  rootCause: string;
  nonDetectionWhys: string[];
  rootCauseWhys: string[];
  plans: A3Analysis["plans"];
}

type IshikawaKey = keyof A3Analysis["ishikawa"];

const draftStorageKey = "integraq.a3Draft";
const stepLabels = [
  "Apertura",
  "Severidad",
  "5W2H",
  "Ideas",
  "Ishikawa 6M",
  "Causas",
  "5 Porqués",
  "Plan de acción",
];

const eventTypes = {
  customer: ["Reclamo de cliente", "Hallazgo de cliente", "Auditoría de cliente"],
  internal: ["No conformidad interna", "Desviación de proceso", "Incidente interno"],
  system: ["Hallazgo de auditoría", "Falla del sistema de gestión", "Riesgo del SGC"],
};

const severityOptions: { value: CorrectiveActionSeverity; label: string; description: string }[] = [
  { value: "critical", label: "Crítica", description: "Riesgo legal, seguridad, cliente clave o interrupción mayor." },
  { value: "high", label: "Alta", description: "Impacto importante, reincidencia o afectación al producto." },
  { value: "medium", label: "Media", description: "Desviación contenida con impacto controlable." },
  { value: "low", label: "Baja", description: "Ajuste menor sin impacto inmediato al cliente." },
];

const ishikawaLabels: Record<IshikawaKey, string> = {
  workforce: "Mano de obra",
  machinery: "Maquinaria",
  method: "Método",
  material: "Material",
  environment: "Medio ambiente",
  measurement: "Medición",
};

const emptyFiveW2H: A3Analysis["fiveW2H"] = {
  what: "",
  why: "",
  where: "",
  when: "",
  who: "",
  how: "",
  howMuch: "",
};

function createInitialDraft(): A3Draft {
  return {
    origin: "internal",
    eventType: eventTypes.internal[0],
    relatedParty: "",
    title: "",
    problem: "",
    area: "",
    owner: "",
    dueDate: "",
    severity: "medium",
    severityJustification: "",
    fiveW2H: { ...emptyFiveW2H },
    brainstorm: [],
    ishikawa: { workforce: [], machinery: [], method: [], material: [], environment: [], measurement: [] },
    nonDetectionCause: "",
    rootCause: "",
    nonDetectionWhys: ["", "", "", "", ""],
    rootCauseWhys: ["", "", "", "", ""],
    plans: [{ id: "plan-1", description: "", owner: "", dueDate: "", status: "pending" }],
  };
}

export function A3AnalysisWorkbench({ onCancel, onComplete }: { onCancel: () => void; onComplete: (submission: A3Submission) => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<A3Draft>(() => createInitialDraft());
  const [loaded, setLoaded] = useState(false);
  const [newIdea, setNewIdea] = useState("");
  const [causeInputs, setCauseInputs] = useState<Record<IshikawaKey, string>>({ workforce: "", machinery: "", method: "", material: "", environment: "", measurement: "" });
  const [aiDraft, setAiDraft] = useState<AiRootCauseDraft>();
  const [isAiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  useEffect(() => {
    const restoreDraft = window.setTimeout(() => {
      const saved = window.localStorage.getItem(draftStorageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { step?: number; draft?: A3Draft; aiDraft?: AiRootCauseDraft };
          if (parsed.draft) setDraft(parsed.draft);
          if (parsed.aiDraft) setAiDraft(parsed.aiDraft);
          if (typeof parsed.step === "number") setStep(Math.min(Math.max(parsed.step, 0), stepLabels.length - 1));
        } catch {
          window.localStorage.removeItem(draftStorageKey);
        }
      }
      setLoaded(true);
    }, 0);

    return () => window.clearTimeout(restoreDraft);
  }, []);

  useEffect(() => {
    if (loaded) window.localStorage.setItem(draftStorageKey, JSON.stringify({ step, draft, aiDraft }));
  }, [aiDraft, draft, loaded, step]);

  const completedSteps = useMemo(() => stepLabels.map((_, index) => isStepComplete(index, draft)), [draft]);
  const canContinue = completedSteps[step];

  const setOrigin = (origin: A3Draft["origin"]) => {
    setDraft((current) => ({ ...current, origin, eventType: eventTypes[origin][0], relatedParty: origin === "customer" ? current.relatedParty : "" }));
  };

  const addIdea = () => {
    const idea = newIdea.trim();
    if (!idea) return;
    setDraft((current) => ({ ...current, brainstorm: [...current.brainstorm, idea] }));
    setNewIdea("");
  };

  const addCause = (key: IshikawaKey) => {
    const cause = causeInputs[key].trim();
    if (!cause) return;
    setDraft((current) => ({ ...current, ishikawa: { ...current.ishikawa, [key]: [...current.ishikawa[key], cause] } }));
    setCauseInputs((current) => ({ ...current, [key]: "" }));
  };

  const updatePlan = (id: string, changes: Partial<A3Analysis["plans"][number]>) => {
    setDraft((current) => ({ ...current, plans: current.plans.map((plan) => plan.id === id ? { ...plan, ...changes } : plan) }));
  };

  const resetDraft = () => {
    window.localStorage.removeItem(draftStorageKey);
    setDraft(createInitialDraft());
    setAiDraft(undefined);
    setAiError("");
    setStep(0);
  };

  const requestAiSuggestions = async () => {
    setAiLoading(true);
    setAiError("");
    try {
      const source = getCorrectiveSource(draft.origin);
      const response = await fetch("/api/ai/root-cause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildRootCauseAiRequest({
            title: draft.title,
            problem: draft.problem,
            source,
            severity: draft.severity,
            area: draft.area,
            owner: draft.owner,
            relatedParty: draft.relatedParty || undefined,
            analysis: toA3Analysis(draft),
          }),
        ),
      });
      const payload = (await response.json()) as AiRootCauseDraft & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No fue posible generar sugerencias.");
      setAiDraft(payload);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "No fue posible consultar la IA.");
    } finally {
      setAiLoading(false);
    }
  };

  const addSuggestedAction = (description: string) => {
    setDraft((current) => {
      const emptyPlan = current.plans.find((plan) => !plan.description.trim());
      if (emptyPlan) {
        return {
          ...current,
          plans: current.plans.map((plan) =>
            plan.id === emptyPlan.id
              ? { ...plan, description, owner: current.owner, dueDate: current.dueDate }
              : plan,
          ),
        };
      }

      return {
        ...current,
        plans: [
          ...current.plans,
          {
            id: crypto.randomUUID(),
            description,
            owner: current.owner,
            dueDate: current.dueDate,
            status: "pending",
          },
        ],
      };
    });
  };

  const completeAnalysis = () => {
    const source = getCorrectiveSource(draft.origin);
    window.localStorage.removeItem(draftStorageKey);
    onComplete({
      title: draft.title.trim(),
      problem: draft.problem.trim(),
      source,
      severity: draft.severity,
      area: draft.area.trim(),
      owner: draft.owner.trim(),
      dueDate: draft.dueDate,
      relatedParty: draft.relatedParty || undefined,
      a3: toA3Analysis(draft),
      aiDraft,
    });
  };

  return (
    <section className="a3-workbench">
      <header className="a3-workbench-header">
        <div><p className="module-kicker">Metodología A3</p><h3>Nuevo análisis de acción correctiva</h3><p>Flujo adaptado de CAPA-V01; el borrador se conserva localmente.</p></div>
        <div className="a3-header-actions">
          <a className="button button-secondary" href="https://github.com/Gronk93/CAPA-V01" target="_blank" rel="noreferrer"><ExternalLink size={15} /> Referencia</a>
          <button className="icon-button" type="button" title="Reiniciar borrador" aria-label="Reiniciar borrador" onClick={resetDraft}><RotateCcw size={17} /></button>
        </div>
      </header>

      <nav className="a3-stepper" aria-label="Etapas del análisis A3">
        {stepLabels.map((label, index) => (
          <button className={`${index === step ? "active" : ""} ${completedSteps[index] ? "complete" : ""}`} key={label} type="button" onClick={() => setStep(index)}>
            <span>{completedSteps[index] && index !== step ? <Check size={12} /> : index + 1}</span><small>{label}</small>
          </button>
        ))}
      </nav>

      <div className="a3-stage">
        {step === 0 ? <OpeningStage draft={draft} setDraft={setDraft} setOrigin={setOrigin} /> : null}
        {step === 1 ? <SeverityStage draft={draft} setDraft={setDraft} /> : null}
        {step === 2 ? <FiveW2HStage value={draft.fiveW2H} onChange={(fiveW2H) => setDraft((current) => ({ ...current, fiveW2H }))} /> : null}
        {step === 3 ? <BrainstormStage ideas={draft.brainstorm} newIdea={newIdea} setNewIdea={setNewIdea} addIdea={addIdea} removeIdea={(index) => setDraft((current) => ({ ...current, brainstorm: current.brainstorm.filter((_, itemIndex) => itemIndex !== index) }))} /> : null}
        {step === 4 ? <IshikawaStage value={draft.ishikawa} inputs={causeInputs} setInputs={setCauseInputs} addCause={addCause} removeCause={(key, index) => setDraft((current) => ({ ...current, ishikawa: { ...current.ishikawa, [key]: current.ishikawa[key].filter((_, itemIndex) => itemIndex !== index) } }))} /> : null}
        {step === 5 ? <CausesStage draft={draft} setDraft={setDraft} /> : null}
        {step === 6 ? <WhysStage draft={draft} setDraft={setDraft} /> : null}
        {step === 7 ? <PlansStage draft={draft} setDraft={setDraft} updatePlan={updatePlan} /> : null}
      </div>

      <section className="a3-ai-assistant">
        <header>
          <span><Sparkles size={18} /></span>
          <div><h4>Sugerencias de IA con contexto</h4><p>Descripción integral, proceso, documentación indexada y avance actual del A3.</p></div>
          <button className="button button-ai" type="button" disabled={isAiLoading || draft.problem.trim().length < 15} onClick={requestAiSuggestions}>
            {isAiLoading ? <LoaderCircle className="spin" size={16} /> : aiDraft ? <RefreshCw size={16} /> : <Bot size={16} />}
            {aiDraft ? "Actualizar sugerencias" : "Generar sugerencias"}
          </button>
        </header>
        {aiError ? <div className="inline-error"><ShieldAlert size={16} />{aiError}</div> : null}
        {aiDraft ? (
          <AiSuggestionResult
            draft={aiDraft}
            onUseRootCause={(rootCause) => setDraft((current) => ({ ...current, rootCause }))}
            onAddSuggestedAction={addSuggestedAction}
          />
        ) : (
          <div className="a3-ai-context-state"><span>{draft.problem.trim().length >= 15 ? "Contexto listo para revisión" : "La descripción integral está pendiente"}</span><small>La causa y las acciones solo cambian cuando el responsable acepta una sugerencia.</small></div>
        )}
      </section>

      <footer className="a3-footer">
        <button className="button button-ghost" type="button" onClick={onCancel}>Salir al listado</button>
        <span>{canContinue ? <><Save size={14} /> Borrador guardado</> : <><AlertTriangle size={14} /> Completa la etapa</>}</span>
        <div>
          <button className="button button-secondary" type="button" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ChevronLeft size={16} /> Anterior</button>
          {step < stepLabels.length - 1 ? <button className="button button-primary" type="button" disabled={!canContinue} onClick={() => setStep((current) => Math.min(stepLabels.length - 1, current + 1))}>Siguiente <ChevronRight size={16} /></button> : <button className="button button-primary" type="button" disabled={!canContinue} onClick={completeAnalysis}><ClipboardCheck size={16} /> Crear acción A3</button>}
        </div>
      </footer>
    </section>
  );
}

function OpeningStage({ draft, setDraft, setOrigin }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>>; setOrigin: (origin: A3Draft["origin"]) => void }) {
  return <StageHeading icon={<ClipboardCheck size={20} />} title="1. Apertura del caso" description="Define el origen, el problema y la responsabilidad del análisis.">
    <div className="a3-origin-switch" aria-label="Origen de la acción">
      <button className={draft.origin === "customer" ? "active" : ""} type="button" onClick={() => setOrigin("customer")}>Externa / cliente</button>
      <button className={draft.origin === "internal" ? "active" : ""} type="button" onClick={() => setOrigin("internal")}>Interna</button>
      <button className={draft.origin === "system" ? "active" : ""} type="button" onClick={() => setOrigin("system")}>Sistema de gestión</button>
    </div>
    {draft.origin === "customer" ? <div className="a3-portal-note"><ExternalLink size={16} /><span><strong>Vinculada con el portal del cliente</strong><small>El cliente tendrá una copia de consulta; el análisis y la edición permanecen en IntegraQ.</small></span></div> : null}
    <div className="a3-form-grid">
      <label><span>Tipo de evento</span><select value={draft.eventType} onChange={(event) => setDraft((current) => ({ ...current, eventType: event.target.value }))}>{eventTypes[draft.origin].map((item) => <option key={item}>{item}</option>)}</select></label>
      {draft.origin === "customer" ? <label><span>Cliente relacionado</span><select value={draft.relatedParty} onChange={(event) => setDraft((current) => ({ ...current, relatedParty: event.target.value }))}><option value="">Seleccionar cliente</option>{customerQualityCatalog.map((customer) => <option key={customer.id} value={customer.name}>{customer.name}</option>)}</select></label> : <label><span>Área o proceso</span><input value={draft.area} onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))} placeholder="Ej. Tintorería" /></label>}
      {draft.origin === "customer" ? <label><span>Área o proceso</span><input value={draft.area} onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))} placeholder="Ej. Tejido" /></label> : null}
      <label><span>Responsable del análisis</span><input value={draft.owner} onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))} /></label>
      <label className="wide"><span>Título</span><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Resumen breve del problema" /></label>
      <label className="wide"><span>Descripción del problema</span><textarea rows={4} value={draft.problem} onChange={(event) => setDraft((current) => ({ ...current, problem: event.target.value }))} placeholder="Qué ocurrió, dónde, cuándo y con qué evidencia" /></label>
      <label><span>Fecha compromiso</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label>
    </div>
  </StageHeading>;
}

function SeverityStage({ draft, setDraft }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>> }) {
  return <StageHeading icon={<AlertTriangle size={20} />} title="2. Evaluación de severidad" description="Clasifica el impacto y documenta el criterio utilizado.">
    <div className="a3-severity-grid">{severityOptions.map((option) => <button className={draft.severity === option.value ? `active severity-${option.value}` : ""} key={option.value} type="button" onClick={() => setDraft((current) => ({ ...current, severity: option.value }))}><strong>{option.label}</strong><span>{option.description}</span></button>)}</div>
    <label className="a3-single-field"><span>Justificación de severidad</span><textarea rows={5} value={draft.severityJustification} onChange={(event) => setDraft((current) => ({ ...current, severityJustification: event.target.value }))} /></label>
  </StageHeading>;
}

function FiveW2HStage({ value, onChange }: { value: A3Analysis["fiveW2H"]; onChange: (value: A3Analysis["fiveW2H"]) => void }) {
  const fields: { key: keyof A3Analysis["fiveW2H"]; label: string; prompt: string }[] = [
    { key: "what", label: "¿Qué?", prompt: "Problema o desviación específica" }, { key: "why", label: "¿Por qué importa?", prompt: "Impacto y razón para actuar" },
    { key: "where", label: "¿Dónde?", prompt: "Proceso, equipo o punto de detección" }, { key: "when", label: "¿Cuándo?", prompt: "Fecha, turno o condición" },
    { key: "who", label: "¿Quién?", prompt: "Personas o roles involucrados" }, { key: "how", label: "¿Cómo?", prompt: "Forma en que ocurrió o se detectó" },
    { key: "howMuch", label: "¿Cuánto?", prompt: "Cantidad, frecuencia, costo o alcance" },
  ];
  return <StageHeading icon={<Target size={20} />} title="3. Definición 5W2H" description="Acota el problema con información verificable antes de buscar causas."><div className="a3-question-grid">{fields.map((field) => <label key={field.key}><span>{field.label}</span><textarea rows={3} value={value[field.key]} onChange={(event) => onChange({ ...value, [field.key]: event.target.value })} placeholder={field.prompt} /></label>)}</div></StageHeading>;
}

function BrainstormStage({ ideas, newIdea, setNewIdea, addIdea, removeIdea }: { ideas: string[]; newIdea: string; setNewIdea: (value: string) => void; addIdea: () => void; removeIdea: (index: number) => void }) {
  return <StageHeading icon={<Lightbulb size={20} />} title="4. Lluvia de ideas" description="Registra causas potenciales sin evaluarlas todavía."><div className="a3-inline-entry"><input value={newIdea} onChange={(event) => setNewIdea(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addIdea(); } }} placeholder="Agregar una causa posible" /><button className="button button-secondary" type="button" onClick={addIdea}><Plus size={15} /> Agregar</button></div><div className="a3-idea-list">{ideas.map((idea, index) => <div key={`${idea}-${index}`}><span>{index + 1}</span><p>{idea}</p><button type="button" title="Eliminar idea" aria-label="Eliminar idea" onClick={() => removeIdea(index)}><Trash2 size={14} /></button></div>)}</div><p className="a3-stage-hint">Se requieren al menos tres ideas para avanzar.</p></StageHeading>;
}

function IshikawaStage({ value, inputs, setInputs, addCause, removeCause }: { value: A3Analysis["ishikawa"]; inputs: Record<IshikawaKey, string>; setInputs: React.Dispatch<React.SetStateAction<Record<IshikawaKey, string>>>; addCause: (key: IshikawaKey) => void; removeCause: (key: IshikawaKey, index: number) => void }) {
  return <StageHeading icon={<GitBranch size={20} />} title="5. Ishikawa 6M" description="Organiza las causas potenciales por familia para reconocer patrones."><div className="ishikawa-grid">{(Object.keys(ishikawaLabels) as IshikawaKey[]).map((key) => <section key={key}><h5>{ishikawaLabels[key]} <span>{value[key].length}</span></h5><div><input value={inputs[key]} onChange={(event) => setInputs((current) => ({ ...current, [key]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCause(key); } }} placeholder="Agregar causa" /><button type="button" title={`Agregar a ${ishikawaLabels[key]}`} aria-label={`Agregar a ${ishikawaLabels[key]}`} onClick={() => addCause(key)}><Plus size={14} /></button></div><ul>{value[key].map((cause, index) => <li key={`${cause}-${index}`}><span>{cause}</span><button type="button" title="Eliminar causa" aria-label="Eliminar causa" onClick={() => removeCause(key, index)}><Trash2 size={12} /></button></li>)}</ul></section>)}</div></StageHeading>;
}

function CausesStage({ draft, setDraft }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>> }) {
  return <StageHeading icon={<Brain size={20} />} title="6. Causa de no detección y causa raíz" description="Separa por qué ocurrió el problema de por qué el sistema no lo detectó."><div className="a3-causes-grid"><label><span>Causa de no detección</span><textarea rows={7} value={draft.nonDetectionCause} onChange={(event) => setDraft((current) => ({ ...current, nonDetectionCause: event.target.value }))} placeholder="¿Qué control faltó o falló?" /></label><label><span>Causa raíz de ocurrencia</span><textarea rows={7} value={draft.rootCause} onChange={(event) => setDraft((current) => ({ ...current, rootCause: event.target.value }))} placeholder="¿Qué condición sistémica originó el problema?" /></label></div></StageHeading>;
}

function WhysStage({ draft, setDraft }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>> }) {
  return <StageHeading icon={<ListChecks size={20} />} title="7. Cinco Porqués" description="Profundiza por separado en la no detección y en la causa de ocurrencia."><div className="a3-whys-grid"><WhysEditor title="No detección" source={draft.nonDetectionCause} values={draft.nonDetectionWhys} onChange={(values) => setDraft((current) => ({ ...current, nonDetectionWhys: values }))} /><WhysEditor title="Causa raíz" source={draft.rootCause} values={draft.rootCauseWhys} onChange={(values) => setDraft((current) => ({ ...current, rootCauseWhys: values }))} /></div><p className="a3-stage-hint">Completa al menos tres respuestas en cada cadena.</p></StageHeading>;
}

function WhysEditor({ title, source, values, onChange }: { title: string; source: string; values: string[]; onChange: (values: string[]) => void }) {
  return <section><header><strong>{title}</strong><small>{source}</small></header>{values.map((value, index) => <label key={index}><span>¿Por qué {index + 1}?</span><textarea rows={2} value={value} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}</section>;
}

function PlansStage({ draft, setDraft, updatePlan }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>>; updatePlan: (id: string, changes: Partial<A3Analysis["plans"][number]>) => void }) {
  return <StageHeading icon={<ClipboardCheck size={20} />} title="8. Plan de acción" description="Convierte el análisis en acciones responsables y verificables."><div className="a3-analysis-summary"><div><small>Origen</small><strong>{draft.origin === "customer" ? "Externa / cliente" : draft.origin === "system" ? "Sistema de gestión" : "Interna"}</strong></div><div><small>Causa raíz</small><strong>{draft.rootCause}</strong></div><div><small>Causas 6M</small><strong>{Object.values(draft.ishikawa).flat().length}</strong></div></div><div className="a3-plan-list">{draft.plans.map((plan, index) => <section key={plan.id}><header><strong>Acción {index + 1}</strong>{draft.plans.length > 1 ? <button type="button" title="Eliminar acción" aria-label="Eliminar acción" onClick={() => setDraft((current) => ({ ...current, plans: current.plans.filter((item) => item.id !== plan.id) }))}><Trash2 size={14} /></button> : null}</header><div><label className="wide"><span>Acción propuesta</span><textarea rows={3} value={plan.description} onChange={(event) => updatePlan(plan.id, { description: event.target.value })} /></label><label><span>Responsable</span><input value={plan.owner} onChange={(event) => updatePlan(plan.id, { owner: event.target.value })} /></label><label><span>Fecha compromiso</span><input type="date" value={plan.dueDate} onChange={(event) => updatePlan(plan.id, { dueDate: event.target.value })} /></label></div></section>)}</div><button className="button button-secondary" type="button" onClick={() => setDraft((current) => ({ ...current, plans: [...current.plans, { id: crypto.randomUUID(), description: "", owner: "", dueDate: "", status: "pending" }] }))}><Plus size={15} /> Agregar acción</button></StageHeading>;
}

function StageHeading({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className="a3-stage-content"><header><span>{icon}</span><div><h4>{title}</h4><p>{description}</p></div></header>{children}</section>;
}

function isStepComplete(step: number, draft: A3Draft) {
  switch (step) {
    case 0: return Boolean(draft.title.trim() && draft.problem.trim().length >= 15 && draft.area.trim() && draft.owner.trim() && draft.dueDate && (draft.origin !== "customer" || draft.relatedParty));
    case 1: return Boolean(draft.severity && draft.severityJustification.trim());
    case 2: return Object.values(draft.fiveW2H).every((value) => value.trim());
    case 3: return draft.brainstorm.length >= 3;
    case 4: return Object.values(draft.ishikawa).flat().length >= 3;
    case 5: return Boolean(draft.nonDetectionCause.trim() && draft.rootCause.trim());
    case 6: return draft.nonDetectionWhys.filter((value) => value.trim()).length >= 3 && draft.rootCauseWhys.filter((value) => value.trim()).length >= 3;
    case 7: return draft.plans.length > 0 && draft.plans.every((plan) => plan.description.trim() && plan.owner.trim() && plan.dueDate);
    default: return false;
  }
}

function getCorrectiveSource(origin: A3Draft["origin"]): CorrectiveActionSource {
  return origin === "customer" ? "customer" : origin === "system" ? "audit" : "internal";
}

function toA3Analysis(draft: A3Draft): A3Analysis {
  return {
    eventType: draft.eventType,
    severityJustification: draft.severityJustification,
    fiveW2H: draft.fiveW2H,
    brainstorm: draft.brainstorm,
    ishikawa: draft.ishikawa,
    nonDetectionCause: draft.nonDetectionCause,
    rootCause: draft.rootCause,
    nonDetectionWhys: draft.nonDetectionWhys,
    rootCauseWhys: draft.rootCauseWhys,
    plans: draft.plans,
  };
}
