"use client";

import {
  AlertTriangle,
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
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { A3ProposalReview } from "@/components/modules/a3-proposal-review";
import { A3StepEvidence } from "@/components/modules/a3-step-evidence";
import { applyStageSuggestion, stageSnapshot, proposalContext, assertProposalContext, assertProposalSnapshots, type RootCauseProposal, type StageSuggestion } from "@/lib/root2cause/assistant";
import { processCatalog } from "@/lib/configuration-data";
import { canAccessProcess } from "@/lib/session-data";

import { useScopedDraft, useContinuityState } from "@/components/workspace-continuity";
import { confirmLeaving } from "@/lib/workspace-continuity";
import { ClaimEditor } from "@/components/modules/customer-claims-panel";
import { claimsRequest, type ClaimsCatalog, type CustomerClaim } from "@/lib/customer-claims";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { loadRootCauseCustomers, type RootCauseCustomer } from "@/lib/root-cause-customers";
import { listRootCauseDrafts, loadRootCauseDraft, saveRootCauseDraft, type RootCauseStoredDraft } from "@/lib/root-cause-draft-storage";
import type { ActiveSession } from "@/lib/session-data";

import type {
  A3Analysis,
  AiRootCauseDraft,
  CorrectiveActionSeverity,
  CorrectiveActionSource,
} from "@/lib/types";

export interface A3Submission {
  draftId: string;
  draftRevision: number;
  processId?: string;
  title: string;
  problem: string;
  source: CorrectiveActionSource;
  severity: CorrectiveActionSeverity;
  area: string;
  owner: string;
  dueDate: string;
  relatedParty?: string;
  relatedPartyId?: string;
  qualityCaseId?: string;
  externalClaimReference?: string;
  a3: A3Analysis;
  aiDraft?: AiRootCauseDraft;
}

interface A3Draft {
  evidenceId?: string;
  processId?: string;
  reviewedSteps?: number[];
  externalClaimReference: string;
  brainstormIds: string[];
  causeItems: NonNullable<A3Analysis["causeItems"]>;
  rootCauseCauseId?: string;
  origin: "customer" | "internal" | "system";
  eventType: string;
  relatedParty: string;
  relatedPartyId: string;
  qualityCaseId: string;
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

const draftStorageKey = "a3";

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

function createInitialDraft(claim?: CustomerClaim): A3Draft {
  return {
    evidenceId: crypto.randomUUID(),
    reviewedSteps: [],
    externalClaimReference: "",
    brainstormIds: [],
    causeItems: [],
    origin: claim ? "customer" : "internal",
    eventType: claim ? eventTypes.customer[0] : eventTypes.internal[0],

    relatedParty: "",
    relatedPartyId: claim?.external_organization_id ?? "",
    qualityCaseId: claim?.id ?? "",
    title: claim?.title ?? "",
    problem: claim?.description ?? "",
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
    plans: [{ id: crypto.randomUUID(), description: "", owner: "", dueDate: "", status: "pending" }],
  };
}

export function A3AnalysisWorkbench({ onCancel, onComplete, session, initialClaim, onCustomerCatalog }: { onCancel: () => void; onComplete: (submission: A3Submission) => Promise<void>; session: ActiveSession; initialClaim?: CustomerClaim; onCustomerCatalog?: () => void }) {
  const storageKey = initialClaim ? `${draftStorageKey}.claim.${initialClaim.id}` : draftStorageKey;
  const persistence=useScopedDraft<{step:number;draft:A3Draft;aiDraft?:AiRootCauseDraft;newIdea?:string;causeInputs?:Record<IshikawaKey,string>}>(storageKey);
  const [claimEditorCatalog,setClaimEditorCatalog]=useState<ClaimsCatalog|null>(null);
  const [step, setStep] = useContinuityState(`${storageKey}:step`,0);
  const [draft, setDraft] = useState<A3Draft>(() => createInitialDraft(initialClaim));
  const [draftId, setDraftId] = useState<string>();
  const [draftRevision, setDraftRevision] = useState(0);
  const [drafts, setDrafts] = useState<Omit<RootCauseStoredDraft, "payload">[]>([]);
  const [draftListError, setDraftListError] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const preferServerDraft = useRef(false);

  const [loaded, setLoaded] = useState(false);
  const [newIdea, setNewIdea] = useState("");
  const [causeInputs, setCauseInputs] = useState<Record<IshikawaKey, string>>({ workforce: "", machinery: "", method: "", material: "", environment: "", measurement: "" });
  const [aiDraft, setAiDraft] = useState<AiRootCauseDraft>();
  const [isAiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [proposal, setProposal] = useState<RootCauseProposal>();
  const requestSnapshots = useRef<string[]>([]);
  const requestContext = useRef("");
  const [customers, setCustomers] = useState<RootCauseCustomer[]>([]);
  const [customerError, setCustomerError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setSaving] = useState(false);

  useEffect(() => {
    if (session.workspaceMode === "demo") return;
    let active = true;
    void loadRootCauseCustomers()
      .then(result => { if (active) { setCustomers(result.customers); setCustomerError(""); } })
      .catch(cause => { if (active) setCustomerError(cause instanceof Error ? cause.message : "No se pudieron consultar los clientes."); });
    return () => { active = false; };
  }, [session.workspaceMode]);

  const refreshSavedDrafts = async () => {
    if (session.workspaceMode === "demo") return;
    try { setDrafts(await listRootCauseDrafts()); setDraftListError(""); }
    catch (error) { setDraftListError(error instanceof Error ? error.message : "No se pudieron consultar los borradores guardados."); }
  };

  useEffect(() => {
    if (session.workspaceMode === "demo") return;
    let active = true;
    void listRootCauseDrafts().then(result => { if (active) { setDrafts(result); setDraftListError(""); } })
      .catch(error => { if (active) setDraftListError(error instanceof Error ? error.message : "No se pudieron consultar los borradores guardados."); });
    return () => { active = false; };
  }, [session.workspaceMode]);

  const resumeSavedDraft = async (id: string) => {
    setSaving(true); setSaveError("");
    try {
      const result = await loadRootCauseDraft(id);
      const saved = result.draft;
      preferServerDraft.current = true;
      setLoaded(false);
      setDraftId(saved.id); setDraftRevision(saved.revision); setDraftSaved(true);
      setDraft(normalizeDraft(saved.payload.draft as unknown as A3Draft));
      setStep(Math.min(Math.max(saved.currentStep, 0), stepLabels.length - 1));
      setAiDraft(saved.payload.aiDraft as AiRootCauseDraft | undefined);
      setNewIdea(saved.payload.newIdea ?? ""); setCauseInputs(saved.payload.causeInputs ?? { workforce: "", machinery: "", method: "", material: "", environment: "", measurement: "" });
      setLoaded(true);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "No se pudo reabrir el borrador."); }
    finally { setSaving(false); }
  };

  const persistDraft = async (targetStep = step) => {
    const id = draftId ?? draft.evidenceId ?? crypto.randomUUID();
    const savedDraft = { ...draft, evidenceId: id };
    if (session.workspaceMode === "demo") {
      persistence.write({ step: targetStep, draft: savedDraft, ...(aiDraft ? { aiDraft } : {}), newIdea, causeInputs });
      persistence.dirty(true); setDraft(savedDraft); setDraftId(id); setDraftSaved(true);
      return { id, revision: 0 };
    }
    const result = await saveRootCauseDraft({ id, revision: draftRevision, currentStep: targetStep,
      payload: { step: targetStep, draft: savedDraft as unknown as Record<string, unknown>, ...(aiDraft ? { aiDraft } : {}), newIdea, causeInputs } });
    setDraft(savedDraft); setDraftId(result.id); setDraftRevision(result.revision); setDraftSaved(true);
    persistence.write({ step: targetStep, draft: savedDraft, ...(aiDraft ? { aiDraft } : {}), newIdea, causeInputs });
    persistence.dirty(true); await refreshSavedDrafts();
    return { id: result.id, revision: result.revision };
  };

  const navigateToStep = async (targetStep: number) => {
    if (targetStep < 0 || targetStep >= stepLabels.length || targetStep === step || isSaving) return;
    setSaving(true); setSaveError("");
    try { await persistDraft(targetStep); setStep(targetStep); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "No se guardó el avance; permanece en la etapa actual."); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    const restoreDraft = window.setTimeout(() => {
      if (preferServerDraft.current) {
        preferServerDraft.current = false;
        setLoaded(true);
        return;
      }
      const saved = persistence.read();
      if (saved) {
        try {
          const parsed = saved;
          if (parsed.draft) setDraft(normalizeDraft(parsed.draft));
          if(parsed.newIdea)setNewIdea(parsed.newIdea);
          if(parsed.causeInputs)setCauseInputs(parsed.causeInputs);
          if (parsed.aiDraft) setAiDraft(parsed.aiDraft);
          if (typeof parsed.step === "number") setStep(Math.min(Math.max(parsed.step, 0), stepLabels.length - 1));
        } catch {
          persistence.clear();
        }
      }
      setLoaded(true);
    }, 0);

    return () => window.clearTimeout(restoreDraft);
  }, [storageKey,persistence,setStep]);

  useEffect(() => {
    if (loaded) {
      const hasText=JSON.stringify({...draft,evidenceId:undefined})!==JSON.stringify({...createInitialDraft(initialClaim),evidenceId:undefined})||Boolean(aiDraft)||Boolean(newIdea)||Object.values(causeInputs).some(Boolean);
      if(hasText){persistence.write({ step, draft, ...(aiDraft?{aiDraft}:{}),newIdea,causeInputs });persistence.dirty(true);}
    }
  }, [aiDraft, draft, loaded, step, storageKey, newIdea, causeInputs, initialClaim,persistence]);


  useEffect(()=>()=>persistence.dirty(false),[persistence]);
  const completedSteps = useMemo(() => stepLabels.map((_, index) => isStepComplete(index, draft)), [draft]);
  const canContinue = completedSteps[step];

  const setOrigin = (origin: A3Draft["origin"]) => {
    setDraft((current) => ({ ...current, origin, eventType: eventTypes[origin][0],
      relatedParty: origin === "customer" ? current.relatedParty : "",
      relatedPartyId: origin === "customer" ? current.relatedPartyId : "",
      qualityCaseId: origin === "customer" ? current.qualityCaseId : "",
    }));
  };

  const addIdea = () => {
    const idea = newIdea.trim();
    if (!idea) return;
    const id = crypto.randomUUID();
    setDraft((current) => ({ ...current, brainstorm: [...current.brainstorm, idea], brainstormIds: [...current.brainstormIds, id], causeItems: [...current.causeItems, { id: crypto.randomUUID(), text: idea, category: null, sourceIdeaId: id }] }));
    setNewIdea("");
  };

  const addCause = (key: IshikawaKey) => {
    const cause = causeInputs[key].trim();
    if (!cause) return;
    setDraft((current) => ({ ...current, causeItems: [...current.causeItems, { id: crypto.randomUUID(), text: cause, category: key }], ishikawa: { ...current.ishikawa, [key]: [...current.ishikawa[key], cause] } }));
    setCauseInputs((current) => ({ ...current, [key]: "" }));
  };

  const updateCause = (id: string, changes: Partial<NonNullable<A3Analysis["causeItems"]>[number]>) => {
    setDraft((current) => {
      const causeItems = current.causeItems.map(item => item.id === id ? { ...item, ...changes } : item);
      const ishikawa = Object.fromEntries((Object.keys(ishikawaLabels) as IshikawaKey[]).map(key => [key, causeItems.filter(item => item.category === key).map(item => item.text)])) as A3Analysis["ishikawa"];
      return { ...current, causeItems, ishikawa };
    });
  };

  const updatePlan = (id: string, changes: Partial<A3Analysis["plans"][number]>) => {
    setDraft((current) => ({ ...current, plans: current.plans.map((plan) => plan.id === id ? { ...plan, ...changes } : plan) }));
  };

  const resetDraft = () => {
    if (!window.confirm("Reiniciar vaciará el análisis no aprobado. Se conservarán los vínculos de evidencias del expediente.")) return;
    persistence.clear();
    setProposal(undefined);
    setDraft(current => ({...createInitialDraft(initialClaim),evidenceId:current.evidenceId,plans:current.plans,processId:current.processId}));

    setAiDraft(undefined);
    setAiError("");
    setStep(0);
  };

  const requestAiSuggestions = async (mode:"full"|"step"="step") => {
    setAiLoading(true);setAiError("");setProposal(undefined);
    requestContext.current=proposalContext(draft.problem,draft.processId);
    const analysis=toA3Analysis(draft);requestSnapshots.current=stepLabels.map((_,i)=>stageSnapshot(analysis,i));
    try {
      const response=await fetch("/api/ai/root-cause/assist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,step,processId:draft.processId,problem:draft.problem,analysis})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error??"No fue posible consultar la IA.");setProposal(payload);
    }catch(error){setAiError(error instanceof Error?error.message:"No fue posible consultar la IA.");}finally{setAiLoading(false);}
  };
  const acceptSuggestion=(suggestion:StageSuggestion)=>{
    if(!window.confirm("¿Incorporar esta propuesta revisada como borrador de la etapa? No confirma la causa ni aprueba acciones."))return false;
    try{assertProposalContext(requestContext.current,draft.problem,draft.processId);const currentAnalysis=toA3Analysis(draft);assertProposalSnapshots(currentAnalysis,requestSnapshots.current);const next=applyStageSuggestion(currentAnalysis,suggestion,requestSnapshots.current[suggestion.step]);requestSnapshots.current[suggestion.step]=stageSnapshot(next,suggestion.step);setDraft(current=>{
      let updated={...current,...next};
      if(suggestion.step===3){
        const ids=next.brainstorm.map((_,index)=>current.brainstormIds[index]??crypto.randomUUID());
        const existing=new Map(current.causeItems.filter(item=>item.sourceIdeaId).map(item=>[item.sourceIdeaId!,item]));
        const linked=next.brainstorm.map((text,index)=>({...existing.get(ids[index]),id:existing.get(ids[index])?.id??crypto.randomUUID(),text,category:existing.get(ids[index])?.category??null,sourceIdeaId:ids[index]}));
        updated={...updated,brainstormIds:ids,causeItems:[...current.causeItems.filter(item=>!item.sourceIdeaId),...linked]};
      }
      if(suggestion.step===4){
        const prior=current.causeItems.filter(item=>item.sourceIdeaId||item.category===null),used=new Set<string>();
        const categorized=(Object.keys(ishikawaLabels) as IshikawaKey[]).flatMap(category=>next.ishikawa[category].map(text=>{
          const old=current.causeItems.find(item=>!used.has(item.id)&&item.category===category&&item.text===text);if(old)used.add(old.id);
          return {id:old?.id??crypto.randomUUID(),text,category,sourceIdeaId:old?.sourceIdeaId};
        }));
        updated={...updated,causeItems:[...prior.filter(item=>!categorized.some(value=>value.sourceIdeaId&&value.sourceIdeaId===item.sourceIdeaId)),...categorized]};
      }
      if(suggestion.step===5 && updated.rootCause.trim() && !updated.rootCauseCauseId) updated.rootCauseCauseId=crypto.randomUUID();
      return updated;
    });return true;}
    catch(error){setAiError(error instanceof Error?error.message:"No se incorporó la propuesta.");return false;}
  };

  const completeAnalysis = async () => {
    if (isSaving) return;
    const missing = getMissingFinalRequirements(draft);
    if (missing.length) { setSaveError(`No se puede finalizar. Faltan: ${missing.join("; ")}.`); return; }
    const source = getCorrectiveSource(draft.origin);
    setSaving(true); setSaveError("");
    try {
      const persisted = await persistDraft();
      await onComplete({
      draftId: persisted.id,
      draftRevision: persisted.revision,
      processId: draft.processId,
      title: draft.title.trim(),
      problem: draft.problem.trim(),
      source,
      severity: draft.severity,
      area: draft.area.trim(),
      owner: draft.owner.trim(),
      dueDate: draft.dueDate,
      relatedParty: draft.relatedParty || undefined,
      relatedPartyId: draft.relatedPartyId || undefined,
      qualityCaseId: draft.qualityCaseId || undefined,
      externalClaimReference: draft.externalClaimReference.trim() || undefined,
      a3: toA3Analysis(draft),
      aiDraft,
      });
      persistence.clear();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No fue posible guardar el análisis.");
    } finally { setSaving(false); }

  };

  return (
    <section className="a3-workbench">
      <header className="a3-workbench-header">
        <div><p className="module-kicker">Metodología A3</p><h3>Nuevo análisis de acción correctiva</h3><p>{draftSaved ? "Borrador persistido en el expediente Root2Cause." : "Guarda el borrador para continuar desde otro inicio de sesión autorizado al proceso."}</p></div>

        <div className="a3-header-actions">
          <button className="icon-button" type="button" title="Reiniciar borrador" aria-label="Reiniciar borrador" onClick={resetDraft}><RotateCcw size={17} /></button>
        </div>
      </header>

      {session.workspaceMode !== "demo" ? <section className="a3-stage-hint" aria-label="Borradores guardados">
        <strong>Continuar un borrador guardado</strong>
        {draftListError ? <p role="alert">{draftListError}</p> : drafts.length ? <div>{drafts.map(item => <button className="button button-secondary" type="button" key={item.id} disabled={isSaving} onClick={() => void resumeSavedDraft(item.id)}>
          {item.title || "Análisis sin título"} · {item.source === "customer" ? "Externa" : item.source === "sgc" ? "SGC" : "Interna"} · etapa {item.currentStep + 1} · revisión {item.revision}
        </button>)}</div> : <p>No hay borradores guardados disponibles para tus permisos de proceso.</p>}
      </section> : null}

      <nav className="a3-stepper" aria-label="Etapas del análisis A3">
        {stepLabels.map((label, index) => (
          <button className={`${index === step ? "active" : ""} ${completedSteps[index] ? "complete" : ""}`} key={label} type="button" disabled={isSaving} onClick={() => void navigateToStep(index)}>
            <span>{completedSteps[index] && index !== step ? <Check size={12} /> : index + 1}</span><small>{label}</small>
          </button>
        ))}
      </nav>

      <div className="a3-stage">
        {step === 0 ? <><OpeningStage draft={draft} setDraft={setDraft} setOrigin={setOrigin} customers={customers} customerError={customerError} session={session} loading={isAiLoading} generate={()=>void requestAiSuggestions("full")} />{draft.origin==="customer"&&draft.relatedPartyId&&canPerformModuleAction(session,"customers","create")?<button className="button button-secondary" type="button" onClick={()=>{void claimsRequest<ClaimsCatalog>().then(setClaimEditorCatalog).catch(e=>setCustomerError((e as Error).message));}}>Registrar reclamo sin perder el avance del A3</button>:null}</> : null}
        {claimEditorCatalog?<ClaimEditor onCustomerCatalog={onCustomerCatalog} catalog={claimEditorCatalog} customerId={draft.relatedPartyId} title={draft.title} description={draft.problem} administrator={session.userType==="Administrador"} onClose={()=>setClaimEditorCatalog(null)} onSaved={async claim=>{const result=await loadRootCauseCustomers();setCustomers(result.customers);setDraft(current=>({...current,relatedPartyId:claim.external_organization_id,relatedParty:result.customers.find(c=>c.id===claim.external_organization_id)?.name??"",qualityCaseId:claim.id}));setClaimEditorCatalog(null);}}/>:null}

        {step === 1 ? <SeverityStage draft={draft} setDraft={setDraft} /> : null}
        {step === 2 ? <FiveW2HStage value={draft.fiveW2H} onChange={(fiveW2H) => setDraft((current) => ({ ...current, fiveW2H }))} /> : null}
        {step === 3 ? <BrainstormStage ideas={draft.brainstorm} ids={draft.brainstormIds} onEdit={(index, text) => setDraft(current => { const brainstorm=[...current.brainstorm];brainstorm[index]=text;const id=current.brainstormIds[index];return {...current,brainstorm,causeItems:current.causeItems.map(item=>item.sourceIdeaId===id?{...item,text}:item),ishikawa:Object.fromEntries((Object.keys(ishikawaLabels) as IshikawaKey[]).map(key=>[key,current.causeItems.filter(item=>item.category===key).map(item=>item.sourceIdeaId===id?text:item.text)])) as A3Analysis["ishikawa"]}; })} newIdea={newIdea} setNewIdea={setNewIdea} addIdea={addIdea} /> : null}
        {step === 4 ? <IshikawaStage value={draft.ishikawa} items={draft.causeItems} inputs={causeInputs} setInputs={setCauseInputs} addCause={addCause} updateCause={updateCause} /> : null}
        {step === 5 ? <CausesStage draft={draft} setDraft={setDraft} /> : null}
        {step === 6 ? <WhysStage draft={draft} setDraft={setDraft} /> : null}
        {step === 7 ? <PlansStage draft={draft} setDraft={setDraft} updatePlan={updatePlan} /> : null}
        <A3StepEvidence key={`${draft.evidenceId}:${step}`} evidenceId={draft.evidenceId} step={step} processId={draft.processId} persisted={draftSaved}/>
      </div>

      <section className="a3-ai-assistant">
        <header>
          <span><Sparkles size={18} /></span>
          <div><h4>Sugerencias de IA con contexto</h4><p>Descripción integral, proceso, documentación indexada y avance actual del A3.</p></div>
          <button className="button button-ai" type="button" disabled={isAiLoading || draft.problem.trim().length < 15 || !draft.processId} onClick={()=>void requestAiSuggestions("step")}>
            {isAiLoading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} Ayudarme con IA en este paso
          </button>
        </header>
        {aiError ? <div className="inline-error"><ShieldAlert size={16} />{aiError}</div> : null}
        {proposal ? <A3ProposalReview key={JSON.stringify(proposal)} proposal={proposal} reviewed={[]} onAccept={acceptSuggestion} onReject={()=>setProposal(undefined)}/> : <p>Las propuestas requieren revisión. No se inventan documentos ni se aprueban causas automáticamente.</p>}
      </section>

      <footer className="a3-footer">
        <button className="button button-ghost" type="button" onClick={()=>{if(confirmLeaving())onCancel();}}>Salir al listado</button>
        <span>{draftSaved ? <><Save size={14} /> Borrador guardado en Supabase</> : canContinue ? <><Save size={14} /> Borrador local conservado</> : <><AlertTriangle size={14} /> Borrador incompleto conservado localmente</>}</span>
        <div>
          <button className="button button-secondary" type="button" disabled={isSaving} onClick={() => { setSaving(true); setSaveError(""); void persistDraft().catch(error => setSaveError(error instanceof Error ? error.message : "No fue posible guardar el borrador.")).finally(() => setSaving(false)); }}><Save size={15} /> {isSaving ? "Guardando…" : "Guardar borrador"}</button>
          <button className="button button-secondary" type="button" disabled={step === 0 || isSaving} onClick={() => void navigateToStep(step - 1)}><ChevronLeft size={16} /> Anterior</button>
          {step < stepLabels.length - 1 ? <button className="button button-primary" type="button" disabled={!canContinue || isSaving} onClick={() => void navigateToStep(step + 1)}>Siguiente <ChevronRight size={16} /></button> : <button className="button button-primary" type="button" disabled={!canContinue || isSaving} onClick={() => void completeAnalysis()}><ClipboardCheck size={16} /> {isSaving ? "Guardando…" : "Crear acción A3"}</button>}

        </div>
      </footer>
      {getMissingFinalRequirements(draft).length ? <details className="a3-stage-hint"><summary>Faltan estos datos para finalizar ({getMissingFinalRequirements(draft).length})</summary><ul>{getMissingFinalRequirements(draft).map(item => <li key={item}>{item}</li>)}</ul></details> : null}
      {saveError ? <p role="alert">{saveError} El borrador local permanece disponible para reintentar.</p> : null}
    </section>
  );
}

function OpeningStage({ draft, setDraft, setOrigin, customers, customerError, session, loading, generate }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>>; setOrigin: (origin: A3Draft["origin"]) => void; customers: RootCauseCustomer[]; customerError: string; session: ActiveSession; loading: boolean; generate: () => void }) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerOptions, setShowCustomerOptions] = useState(false);
  const selectedCustomer = customers.find(customer => customer.id === draft.relatedPartyId);
  const matchingCustomers = customers.filter(customer => `${customer.code} ${customer.name}`.toLocaleLowerCase("es")
    .includes(customerSearch.trim().toLocaleLowerCase("es"))).slice(0, 12);

  return <StageHeading icon={<ClipboardCheck size={20} />} title="1. Apertura del caso" description="Define el origen, el problema y la responsabilidad del análisis.">
    <div className="a3-origin-switch" aria-label="Origen de la acción">
      <button className={draft.origin === "customer" ? "active" : ""} type="button" onClick={() => setOrigin("customer")}>Externa / cliente</button>
      <button className={draft.origin === "internal" ? "active" : ""} type="button" onClick={() => setOrigin("internal")}>Interna</button>
      <button className={draft.origin === "system" ? "active" : ""} type="button" onClick={() => setOrigin("system")}>SGC</button>
    </div>
    {draft.origin === "customer" ? <div className="a3-portal-note"><ExternalLink size={16} /><span><strong>Cliente identificado</strong><small>La selección no publica el análisis. Un administrador debe autorizarlo expresamente.</small></span></div> : null}
    <div className="a3-form-grid">
      <label><span>Tipo de evento</span><select value={draft.eventType} onChange={(event) => setDraft((current) => ({ ...current, eventType: event.target.value }))}>{eventTypes[draft.origin].map((item) => <option key={item}>{item}</option>)}</select></label>
      {draft.origin === "customer" ? <label className="a3-customer-picker"><span>Cliente relacionado</span><input type="search" role="combobox" aria-autocomplete="list" aria-expanded={showCustomerOptions} aria-controls="a3-customer-options" value={selectedCustomer?.name ?? customerSearch} onFocus={() => setShowCustomerOptions(true)} onChange={event => { setCustomerSearch(event.target.value); setShowCustomerOptions(true); setDraft(current => ({ ...current, relatedPartyId: "", relatedParty: "", qualityCaseId: "" })); }} placeholder="Buscar por nombre o abreviatura" />
        {showCustomerOptions ? <div id="a3-customer-options" className="a3-customer-options" role="listbox">{matchingCustomers.map(customer => <button key={customer.id} type="button" role="option" aria-selected={customer.id === draft.relatedPartyId} onClick={() => { setDraft(current => ({ ...current, relatedPartyId: customer.id, relatedParty: customer.name, qualityCaseId: "" })); setCustomerSearch(customer.name); setShowCustomerOptions(false); }}><strong>{customer.code}</strong><span>{customer.name}</span></button>)}{!matchingCustomers.length ? <p>No hay clientes que coincidan con la búsqueda.</p> : null}</div> : null}
      </label> : <label><span>Área o proceso</span><input value={draft.area} onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))} placeholder="Ej. Tintorería" /></label>}
      {draft.origin === "customer" && customerError ? <p role="alert">{customerError}</p> : null}
      {draft.origin === "customer" && !customerError && customers.length === 0 ? <p>No hay clientes reales activos en el catálogo. Registra el cliente antes de crear un análisis externo.</p> : null}
      {draft.origin === "customer" && draft.relatedPartyId ? <label><span>Número de reclamación del cliente (opcional)</span><input value={draft.externalClaimReference} onChange={event => setDraft(current => ({ ...current, externalClaimReference: event.target.value }))} maxLength={120} placeholder="Referencia proporcionada por el cliente" /></label> : null}
      {draft.origin === "customer" ? <label><span>Área o proceso</span><input value={draft.area} onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))} placeholder="Ej. Tejido" /></label> : null}
      <label><span>Responsable del análisis</span><input value={draft.owner} onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))} /></label>
      <label className="wide"><span>Título</span><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Resumen breve del problema" /></label>
      <label className="wide"><span>Descripción del problema</span><textarea rows={4} value={draft.problem} onChange={(event) => setDraft((current) => ({ ...current, problem: event.target.value }))} placeholder="Qué ocurrió, dónde, cuándo y con qué evidencia" /></label>
      <div className="wide"><label><span>Proceso autorizado para consulta documental</span><select value={draft.processId??""} onChange={e=>setDraft(d=>({...d,processId:e.target.value}))}><option value="">Seleccionar proceso</option>{processCatalog.filter(p=>canAccessProcess(session,p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button type="button" className="button button-ai" disabled={loading||draft.problem.trim().length<15||!draft.processId} onClick={generate}>Generar análisis completo con IA</button></div>
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

function BrainstormStage({ ideas, ids, onEdit, newIdea, setNewIdea, addIdea }: { ideas: string[]; ids: string[]; onEdit: (index: number, text: string) => void; newIdea: string; setNewIdea: (value: string) => void; addIdea: () => void }) {
  return <StageHeading icon={<Lightbulb size={20} />} title="4. Lluvia de ideas" description="Registra causas potenciales sin evaluarlas todavía; cada idea se transfiere al Ishikawa como candidata."><div className="a3-inline-entry"><input value={newIdea} onChange={(event) => setNewIdea(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addIdea(); } }} placeholder="Agregar una causa posible" /><button className="button button-secondary" type="button" onClick={addIdea}><Plus size={15} /> Agregar</button></div><div className="a3-idea-list">{ideas.map((idea, index) => <div key={ids[index] ?? `${idea}-${index}`}><span>{index + 1}</span><input aria-label={`Idea ${index + 1}`} value={idea} onChange={event => onEdit(index, event.target.value)} /></div>)}</div><p className="a3-stage-hint">Se requieren al menos tres ideas. Las ideas se conservan y pueden editarse sin perder su vínculo con Ishikawa.</p></StageHeading>;
}

function IshikawaStage({ value, items, inputs, setInputs, addCause, updateCause }: { value: A3Analysis["ishikawa"]; items: NonNullable<A3Analysis["causeItems"]>; inputs: Record<IshikawaKey, string>; setInputs: React.Dispatch<React.SetStateAction<Record<IshikawaKey, string>>>; addCause: (key: IshikawaKey) => void; updateCause: (id: string, changes: Partial<NonNullable<A3Analysis["causeItems"]>[number]>) => void }) {
  return <StageHeading icon={<GitBranch size={20} />} title="5. Ishikawa 6M" description="Las ideas anteriores aparecen como causas candidatas. Asígnalas, edítalas o cambia su categoría sin perder su relación."><div className="ishikawa-grid">{(Object.keys(ishikawaLabels) as IshikawaKey[]).map((key) => <section key={key}><h5>{ishikawaLabels[key]} <span>{value[key].length}</span></h5><div><input value={inputs[key]} onChange={(event) => setInputs((current) => ({ ...current, [key]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCause(key); } }} placeholder="Agregar causa" /><button type="button" title={`Agregar a ${ishikawaLabels[key]}`} aria-label={`Agregar a ${ishikawaLabels[key]}`} onClick={() => addCause(key)}><Plus size={14} /></button></div><ul>{items.filter(item => item.category === key).map(item => <li key={item.id}><input aria-label={`Causa en ${ishikawaLabels[key]}`} value={item.text} onChange={event => updateCause(item.id, { text: event.target.value })} /><select aria-label="Reclasificar causa" value={item.category ?? ""} onChange={event => updateCause(item.id, { category: (event.target.value || null) as IshikawaKey | null })}><option value="">Sin clasificar</option>{(Object.keys(ishikawaLabels) as IshikawaKey[]).map(category => <option key={category} value={category}>{ishikawaLabels[category]}</option>)}</select></li>)}</ul></section>)}</div><section className="a3-cause-candidates"><h5>Causas candidatas sin clasificar</h5>{items.filter(item => !item.category).map(item => <div key={item.id}><input aria-label="Causa candidata" value={item.text} onChange={event => updateCause(item.id, { text: event.target.value })} /><select aria-label="Clasificación 6M" value="" onChange={event => updateCause(item.id, { category: (event.target.value || null) as IshikawaKey | null })}><option value="">Seleccionar 6M</option>{(Object.keys(ishikawaLabels) as IshikawaKey[]).map(category => <option key={category} value={category}>{ishikawaLabels[category]}</option>)}</select></div>)}</section></StageHeading>;
}

function CausesStage({ draft, setDraft }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>> }) {
  return <StageHeading icon={<Brain size={20} />} title="6. Causa de no detección y causa raíz" description="Separa por qué ocurrió el problema de por qué el sistema no lo detectó. Puedes partir de una causa candidata del Ishikawa."><div className="a3-causes-grid"><label><span>Causa de no detección</span><textarea rows={7} value={draft.nonDetectionCause} onChange={(event) => setDraft((current) => ({ ...current, nonDetectionCause: event.target.value }))} placeholder="¿Qué control faltó o falló?" /></label><label><span>Causa raíz de ocurrencia</span><select value={draft.rootCauseCauseId ?? ""} onChange={event => { const candidate=draft.causeItems.find(item=>item.id===event.target.value);setDraft(current=>({...current,rootCauseCauseId:candidate?.id,rootCause:candidate?.text??current.rootCause})); }}><option value="">Escribir una conclusión propia</option>{draft.causeItems.map(item=><option key={item.id} value={item.id}>{item.text}</option>)}</select><textarea rows={7} value={draft.rootCause} onChange={(event) => setDraft((current) => ({ ...current, rootCause: event.target.value, rootCauseCauseId: current.causeItems.some(item=>item.id===current.rootCauseCauseId) ? crypto.randomUUID() : current.rootCauseCauseId ?? (event.target.value.trim() ? crypto.randomUUID() : undefined) }))} placeholder="¿Qué condición sistémica originó el problema?" /></label></div></StageHeading>;
}

function WhysStage({ draft, setDraft }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>> }) {
  return <StageHeading icon={<ListChecks size={20} />} title="7. Cinco Porqués" description="Profundiza por separado en la no detección y en la causa de ocurrencia."><div className="a3-whys-grid"><WhysEditor title="No detección" source={draft.nonDetectionCause} values={draft.nonDetectionWhys} onChange={(values) => setDraft((current) => ({ ...current, nonDetectionWhys: values }))} /><WhysEditor title="Causa raíz" source={draft.rootCause} values={draft.rootCauseWhys} onChange={(values) => setDraft((current) => ({ ...current, rootCauseWhys: values }))} /></div><p className="a3-stage-hint">Completa al menos tres respuestas en cada cadena.</p></StageHeading>;
}

function WhysEditor({ title, source, values, onChange }: { title: string; source: string; values: string[]; onChange: (values: string[]) => void }) {
  return <section><header><strong>{title}</strong><small>{source}</small></header>{values.map((value, index) => <label key={index}><span>¿Por qué {index + 1}?</span><textarea rows={2} value={value} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>)}</section>;
}

function PlansStage({ draft, setDraft, updatePlan }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>>; updatePlan: (id: string, changes: Partial<A3Analysis["plans"][number]>) => void }) {
  const causes = [...new Map([...draft.causeItems.map(item => [item.id, { id: item.id, text: item.text }] as const), ...(draft.rootCause.trim() ? [[draft.rootCauseCauseId ?? "root", { id: draft.rootCauseCauseId ?? "root", text: draft.rootCause }] as const] : [])]).values()];
  return <StageHeading icon={<ClipboardCheck size={20} />} title="8. Plan de acción" description="Convierte el análisis en acciones responsables y verificables."><div className="a3-analysis-summary"><div><small>Clasificación</small><strong>{draft.origin === "customer" ? "Externa" : draft.origin === "system" ? "SGC" : "Interna"}</strong></div><div><small>Causa raíz</small><strong>{draft.rootCause}</strong></div><div><small>Causas 6M</small><strong>{Object.values(draft.ishikawa).flat().length}</strong></div></div><div className="a3-plan-list">{draft.plans.map((plan, index) => <section key={plan.id}><header><strong>Acción {index + 1}</strong>{draft.plans.length > 1 ? <button type="button" title="Eliminar acción" aria-label="Eliminar acción" onClick={() => setDraft((current) => ({ ...current, plans: current.plans.filter((item) => item.id !== plan.id) }))}><Trash2 size={14} /></button> : null}</header><div><label className="wide"><span>Acción propuesta</span><textarea rows={3} value={plan.description} onChange={(event) => updatePlan(plan.id, { description: event.target.value })} /></label><label><span>Causa que atiende</span><select value={plan.causeId ?? ""} onChange={event=>{const chosen=causes.find(item=>item.id===event.target.value);updatePlan(plan.id,{causeId:chosen?.id,cause:chosen?.text??""});}}><option value="">Seleccionar causa del análisis</option>{causes.map(cause=><option key={cause.id} value={cause.id}>{cause.text}</option>)}</select></label><label><span>Responsable</span><input value={plan.owner} onChange={(event) => updatePlan(plan.id, { owner: event.target.value })} /></label><label><span>Fecha compromiso</span><input type="date" value={plan.dueDate} onChange={(event) => updatePlan(plan.id, { dueDate: event.target.value })} /></label></div>{(["expectedResult","completionEvidence","effectivenessMethod"] as const).map((field,n)=><label className="a3-single-field" key={field}><span>{["Resultado esperado","Evidencia de cumplimiento","Verificación de efectividad"][n]}</span><textarea value={plan[field]??""} onChange={e=>updatePlan(plan.id,{[field]:e.target.value})}/></label>)}<A3StepEvidence evidenceId={draft.evidenceId} step={plan.id} processId={draft.processId}/></section>)}</div><button className="button button-secondary" type="button" onClick={() => setDraft((current) => ({ ...current, plans: [...current.plans, { id: crypto.randomUUID(), description: "", owner: "", dueDate: "", status: "pending" }] }))}><Plus size={15} /> Agregar acción</button></StageHeading>;
}

function StageHeading({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className="a3-stage-content"><header><span>{icon}</span><div><h4>{title}</h4><p>{description}</p></div></header>{children}</section>;
}

function isStepComplete(step: number, draft: A3Draft) {
  switch (step) {
    case 0: return Boolean(draft.title.trim() && draft.problem.trim().length >= 15 && (draft.area.trim() || draft.processId) && draft.owner.trim() && draft.dueDate && (draft.origin !== "customer" || draft.relatedPartyId) && (draft.origin !== "system" || draft.processId));
    case 1: return Boolean(draft.severity && draft.severityJustification.trim());
    case 2: return Object.values(draft.fiveW2H).every((value) => value.trim());
    case 3: return draft.brainstorm.length >= 3;
    case 4: return draft.causeItems.filter(item => item.category).length >= 3;
    case 5: return Boolean(draft.nonDetectionCause.trim() && draft.rootCause.trim());
    case 6: return draft.nonDetectionWhys.filter((value) => value.trim()).length >= 3 && draft.rootCauseWhys.filter((value) => value.trim()).length >= 3;
    case 7: return draft.plans.length > 0 && draft.plans.every((plan) => plan.description.trim() && plan.owner.trim() && plan.dueDate);
    default: return false;
  }
}

function getCorrectiveSource(origin: A3Draft["origin"]): CorrectiveActionSource {
  return origin === "customer" ? "customer" : origin === "system" ? "sgc" : "internal";
}

function toA3Analysis(draft: A3Draft): A3Analysis {
  return {
    evidenceId: draft.evidenceId,
    descriptiveTitle: draft.title.trim() || undefined,
    brainstormIds: draft.brainstormIds,
    causeItems: draft.causeItems,
    rootCauseCauseId: draft.rootCauseCauseId,
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

function normalizeDraft(saved: Partial<A3Draft>): A3Draft {
  const base = { ...createInitialDraft(), ...saved, evidenceId: saved.evidenceId ?? crypto.randomUUID() };
  const brainstormIds = Array.isArray(saved.brainstormIds) && saved.brainstormIds.length === base.brainstorm.length
    ? saved.brainstormIds : base.brainstorm.map(() => crypto.randomUUID());
  const causeItems = Array.isArray(saved.causeItems) ? saved.causeItems : [
    ...base.brainstorm.map((text, index) => ({ id: crypto.randomUUID(), text, category: null as null, sourceIdeaId: brainstormIds[index] })),
    ...(Object.keys(ishikawaLabels) as IshikawaKey[]).flatMap(category => base.ishikawa[category].map(text => ({ id: crypto.randomUUID(), text, category }))),
  ];
  const ishikawa = Object.fromEntries((Object.keys(ishikawaLabels) as IshikawaKey[]).map(category => [category, causeItems.filter(item => item.category === category).map(item => item.text)])) as A3Analysis["ishikawa"];
  return { ...base, brainstormIds, causeItems, ishikawa, externalClaimReference: saved.externalClaimReference ?? "", processId: saved.processId ?? "", relatedPartyId: saved.relatedPartyId ?? "", qualityCaseId: saved.qualityCaseId ?? "" };
}

function getMissingFinalRequirements(draft: A3Draft): string[] {
  const missing: string[] = [];
  if (!draft.title.trim()) missing.push("Título del análisis");
  if (draft.problem.trim().length < 15) missing.push("Descripción del problema (mínimo 15 caracteres)");
  if (!draft.area.trim() && !draft.processId) missing.push("Proceso o área");
  if (draft.origin === "system" && !draft.processId) missing.push("Proceso del SGC");
  if (draft.origin === "customer" && !draft.relatedPartyId) missing.push("Cliente externo del catálogo");
  if (!draft.owner.trim()) missing.push("Responsable del análisis");
  if (!draft.dueDate) missing.push("Fecha compromiso del análisis");
  if (!draft.severityJustification.trim()) missing.push("Justificación de severidad");
  if (Object.entries(draft.fiveW2H).some(([, value]) => !value.trim())) missing.push("Completar todos los campos 5W2H");
  if (draft.brainstorm.filter(item => item.trim()).length < 3) missing.push("Al menos tres ideas de lluvia de ideas");
  if (draft.causeItems.filter(item => item.category && item.text.trim()).length < 3) missing.push("Al menos tres causas clasificadas en Ishikawa 6M");
  if (!draft.nonDetectionCause.trim()) missing.push("Causa de no detección");
  if (!draft.rootCause.trim()) missing.push("Causa raíz de ocurrencia");
  if (draft.nonDetectionWhys.filter(item => item.trim()).length < 3) missing.push("Al menos tres respuestas en los Porqués de no detección");
  if (draft.rootCauseWhys.filter(item => item.trim()).length < 3) missing.push("Al menos tres respuestas en los Porqués de causa raíz");
  if (!draft.plans.length) missing.push("Al menos una acción correctiva");
  draft.plans.forEach((plan, index) => {
    const prefix = `Acción ${index + 1}`;
    if (!plan.description.trim()) missing.push(`${prefix}: descripción`);
    if (!plan.cause?.trim()) missing.push(`${prefix}: causa atendida`);
    if (!plan.owner.trim()) missing.push(`${prefix}: responsable`);
    if (!plan.dueDate) missing.push(`${prefix}: fecha compromiso`);
    if (!plan.expectedResult?.trim()) missing.push(`${prefix}: resultado esperado`);
    if (!plan.completionEvidence?.trim()) missing.push(`${prefix}: evidencia de cumplimiento requerida`);
    if (!plan.effectivenessMethod?.trim()) missing.push(`${prefix}: criterio de efectividad`);
  });
  return missing;
}
