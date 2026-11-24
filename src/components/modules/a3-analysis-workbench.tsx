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
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { A3ProposalReview } from "@/components/modules/a3-proposal-review";
import { writeActiveDraft } from "@/lib/root2cause/draft-cache";
import { changeCause, classifyCauses, causeInUse, removeCause } from "@/lib/root2cause/cause-links";
import { appendBlankActionPlan, ishikawaCategories, isActionPlanReady, removeActionPlan, type RootCauseResponsible } from "@/lib/root2cause/action-plan";
import { A3StepEvidence } from "@/components/modules/a3-step-evidence";
import { applyStageSuggestion, stageSnapshot, proposalContext, assertProposalContext, assertProposalSnapshots, type RootCauseProposal, type StageSuggestion } from "@/lib/root2cause/assistant";
import { processCatalog } from "@/lib/configuration-data";
import { canAccessProcess } from "@/lib/session-data";

import { useScopedDraft } from "@/components/workspace-continuity";
import { confirmLeaving } from "@/lib/workspace-continuity";
import { ClaimEditor } from "@/components/modules/customer-claims-panel";
import { claimsRequest, type ClaimsCatalog, type CustomerClaim } from "@/lib/customer-claims";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { loadRootCauseCustomers, type RootCauseCustomer } from "@/lib/root-cause-customers";
import { RootCauseHttpError, readRootCauseJson, listRootCauseDrafts, loadRootCauseDraft, saveRootCauseDraft, type RootCauseStoredDraft } from "@/lib/root-cause-draft-storage";
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
    externalClaimReference: claim?.external_reference ?? "",
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

const StageHelp = createContext<React.ReactNode>(null);

async function payloadHash(payload: unknown) {
  const canonical = JSON.stringify(payload, (_, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

type WorkbenchProps = { onCancel: () => void; onComplete: (submission: A3Submission) => Promise<void>; session: ActiveSession; initialClaim?: CustomerClaim; onCustomerCatalog?: () => void };
export function A3AnalysisWorkbench(props: WorkbenchProps) {
  const claim = props.initialClaim;
  const linkedId = claim?.selectedDraftId ?? claim?.linkedDraftIds?.[0];
  const [stored, setStored] = useState<RootCauseStoredDraft>();
  const [error,setError] = useState("");
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    if (!linkedId) return;
    let active = true;
    void loadRootCauseDraft(linkedId).then(({draft}) => {
      if (draft.id !== linkedId || draft.payload.draft.qualityCaseId !== claim?.id ||
          draft.payload.draft.relatedPartyId !== claim?.external_organization_id) throw new Error("El vínculo del reclamo cambió.");
      if (active) {setStored(draft);setError("");}
    }).catch(e=>{if(active)setError(e.message);});
    return () => {active=false;};
  },[linkedId,claim?.id,claim?.external_organization_id,retry]);
  if (linkedId && stored?.id !== linkedId) return <section><p role={error?"alert":"status"}>{error || "Recuperando el borrador vinculado…"}</p>
    {error && <button type="button" onClick={()=>setRetry(value=>value+1)}>Reintentar</button>}<button type="button" onClick={props.onCancel}>Volver</button></section>;
  return <DraftEditor key={linkedId ?? claim?.id ?? "new"} {...props} stored={linkedId ? stored : undefined}/>;
}

function DraftEditor({onCancel,onComplete,session,initialClaim,onCustomerCatalog,stored}: WorkbenchProps & {stored?:RootCauseStoredDraft}) {
  const storageKey = initialClaim ? `${draftStorageKey}.claim.${initialClaim.id}` : draftStorageKey;
  type CachedDraft = { revision?: number; confirmedHash?: string; step: number; draft: A3Draft; aiDraft?: AiRootCauseDraft; newIdea?: string; causeInputs?: Record<IshikawaKey,string> };
  const currentCache = useScopedDraft<CachedDraft>(storageKey);
  const otherCaches = useScopedDraft<Record<string, CachedDraft>>(storageKey + ".pending");
  const persistence = useMemo(() => ({
    ...currentCache,
    write(value: CachedDraft) {
      return writeActiveDraft(value, currentCache, otherCaches);
    },
    discard(id?: string) {
      if (!id) return;
      if (currentCache.read()?.draft.evidenceId === id) currentCache.clear();
      const others = otherCaches.read();
      if (others && id in others) {
        delete others[id];
        otherCaches.write(others);
      }
    },
  }), [currentCache, otherCaches]);
  const [availableLocal, setAvailableLocal] = useState<CachedDraft[]>([]);
  const [claimEditorCatalog,setClaimEditorCatalog]=useState<ClaimsCatalog|null>(null);
  const [step, setStep] = useState(stored?.currentStep ?? 0);
  const [initialDraft] = useState(() => stored ? normalizeDraft(stored.payload.draft as Partial<A3Draft>) : createInitialDraft(initialClaim));
  const [draft, setDraft] = useState<A3Draft>(initialDraft);
  const [draftId, setDraftId] = useState(stored?.id);
  const [draftRevision, setDraftRevision] = useState(stored?.revision ?? 0);
  const confirmedHash = useRef<string | undefined>(undefined);
  const [drafts, setDrafts] = useState<Omit<RootCauseStoredDraft, "payload">[]>([]);
  const [draftListError, setDraftListError] = useState("");
  const [confirmedScope, setConfirmedScope] = useState(stored ? JSON.stringify([stored.id,stored.processId ?? "",stored.source,stored.payload.draft.relatedPartyId ?? ""]) : "");
  const [syncError, setSyncError] = useState(false);
  const [cacheError, setCacheError] = useState("");
  const operation = useRef(false);
  const [finalizing, setFinalizing] = useState(false);
  const [opening,setOpening] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const [newIdea, setNewIdea] = useState(stored?.payload.newIdea ?? "");
  const [causeInputs, setCauseInputs] = useState<Record<IshikawaKey, string>>(stored?.payload.causeInputs as Record<IshikawaKey,string> ?? { workforce: "", machinery: "", method: "", material: "", environment: "", measurement: "" });
  const [aiDraft, setAiDraft] = useState<AiRootCauseDraft | undefined>(stored?.payload.aiDraft as AiRootCauseDraft | undefined);
  const [isAiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [proposal, setProposal] = useState<RootCauseProposal>();
  const requestSnapshots = useRef<string[]>([]);
  const requestContext = useRef("");
  const aiController = useRef<AbortController | null>(null);
  useEffect(() => () => aiController.current?.abort(), []);
  const snapshot = JSON.stringify({step, draft, aiDraft, newIdea, causeInputs});
  const [confirmedSnapshot, setConfirmedSnapshot] = useState(stored ? snapshot : "");
  const draftSaved = session.workspaceMode !== "demo" && confirmedSnapshot === snapshot;
  const aiDisabled = isAiLoading || !draft.processId || draft.problem.trim().length < 15;
  const [customers, setCustomers] = useState<RootCauseCustomer[]>([]);
  const [customerError, setCustomerError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setSaving] = useState(false);
  const [responsibleCatalog, setResponsibleCatalog] = useState<{ processId: string; status: "loading" | "loaded"; users: RootCauseResponsible[]; error: string }>({ processId: "", status: "loading", users: [], error: "" });
  const responsibleProcessId = draft.processId ?? "";
  const catalogMatchesProcess = responsibleCatalog.processId === responsibleProcessId;
  const responsibleUsers = useMemo(() => catalogMatchesProcess ? responsibleCatalog.users : [], [catalogMatchesProcess, responsibleCatalog.users]);
  const responsibleUsersError = catalogMatchesProcess ? responsibleCatalog.error : "";
  const loadingResponsibleUsers = !catalogMatchesProcess || responsibleCatalog.status === "loading";

  useEffect(() => {
    if (session.workspaceMode === "demo") return;
    let active = true;
    void loadRootCauseCustomers()
      .then(result => { if (active) { setCustomers(result.customers); setCustomerError(""); } })
      .catch(cause => { if (active) setCustomerError(cause instanceof Error ? cause.message : "No se pudieron consultar los clientes."); });
    return () => { active = false; };
  }, [session.workspaceMode]);

  useEffect(() => {
    if (session.workspaceMode === "demo") return;
    let active = true;
    const query = draft.processId ? `?processId=${encodeURIComponent(draft.processId)}` : "";
    void fetch(`/api/root2cause/responsible-users${query}`, { cache: "no-store" })
      .then(async response => {
        const payload = await response.json() as { users?: RootCauseResponsible[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "No se pudo consultar el catálogo de responsables.");
        if (active) setResponsibleCatalog({ processId: draft.processId ?? "", status: "loaded", users: Array.isArray(payload.users) ? payload.users : [], error: "" });
      })
      .catch(error => { if (active) setResponsibleCatalog({ processId: draft.processId ?? "", status: "loaded", users: [], error: error instanceof Error ? error.message : "No se pudo consultar el catálogo de responsables." }); });
    return () => { active = false; };
  }, [session.workspaceMode, draft.processId]);

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
    if (operation.current) return;
    if (id === draft.evidenceId && !draftSaved && !window.confirm("¿Reemplazar los cambios de este editor por la revisión guardada en Supabase?")) return;
    operation.current = true;
    setSaving(true); setSaveError(""); setSyncError(false);
    setOpening(true);
    try {
      const result = await loadRootCauseDraft(id);
      const saved = result.draft;
      setLoaded(false);
      setProposal(undefined);
      confirmedHash.current = undefined;
      setDraftId(saved.id); setDraftRevision(saved.revision);
      const restored = normalizeDraft(saved.payload.draft as unknown as A3Draft);
      const inputs = saved.payload.causeInputs ?? { workforce: "", machinery: "", method: "", material: "", environment: "", measurement: "" };
      setConfirmedSnapshot(JSON.stringify({step:saved.currentStep,draft:restored,aiDraft:saved.payload.aiDraft,newIdea:saved.payload.newIdea ?? "",causeInputs:inputs}));
      setConfirmedScope(JSON.stringify([saved.id,saved.processId ?? "",saved.source,restored.relatedPartyId ?? ""]));
      setDraft(restored);
      setStep(Math.min(Math.max(saved.currentStep, 0), stepLabels.length - 1));
      setAiDraft(saved.payload.aiDraft as AiRootCauseDraft | undefined);
      setNewIdea(saved.payload.newIdea ?? ""); setCauseInputs(saved.payload.causeInputs ?? { workforce: "", machinery: "", method: "", material: "", environment: "", measurement: "" });
      setLoaded(true);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "No se pudo reabrir el borrador."); }
    finally { operation.current = false; setOpening(false); setSaving(false); }
  };

  const persistDraft = async (targetStep = step, forFinalization = false) => {
    const id = draftId ?? draft.evidenceId ?? crypto.randomUUID();
    const savedDraft = { ...draft, evidenceId: id };
    if (session.workspaceMode === "demo") {
      persistence.write({ step: targetStep, draft: savedDraft, ...(aiDraft ? { aiDraft } : {}), newIdea, causeInputs });
      persistence.dirty(true); setDraftId(id);
      return { id, revision: 0 };
    }
    const payload = { step: targetStep, draft: savedDraft as unknown as Record<string, unknown>, ...(aiDraft ? { aiDraft } : {}), newIdea, causeInputs };
    const hash = await payloadHash(payload);
    if (forFinalization && draftRevision > 0 && confirmedHash.current === hash) {
      return { id, revision: draftRevision };
    }
    const result = await saveRootCauseDraft({ id, revision: draftRevision, currentStep: targetStep, payload });
    confirmedHash.current = hash;
    setDraftId(result.id); setDraftRevision(result.revision); setConfirmedSnapshot(snapshot);
    setConfirmedScope(JSON.stringify([id,draft.processId ?? "",getCorrectiveSource(draft.origin),draft.relatedPartyId ?? ""]));
    persistence.dirty(true); void refreshSavedDrafts();
    return { id: result.id, revision: result.revision };
  };

  const navigateToStep = (targetStep: number) => {
    if (!finalizing && targetStep >= 0 && targetStep < stepLabels.length) setStep(targetStep);
  };

  const saveChanges = async () => {
    if (operation.current) return;
    operation.current = true;
    setSaving(true); setSaveError(""); setSyncError(false);
    try { await persistDraft(); }
    catch (error) { setSyncError(true); setSaveError(error instanceof Error ? error.message : "Supabase no confirmó el guardado."); }
    finally { operation.current = false; setSaving(false); }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = currentCache.read();
      const entries = Object.values(otherCaches.read() ?? {});
      setAvailableLocal(saved ? [saved, ...entries.filter(entry => entry.draft.evidenceId !== saved.draft.evidenceId)] : entries);
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentCache, otherCaches]);

  const resumeLocal = async (entry: CachedDraft) => {
    if (operation.current) return;
    const id = entry.draft.evidenceId;
    const latest = currentCache.read();
    const saved = latest?.draft.evidenceId === id ? latest : id ? otherCaches.read()?.[id] : null;
    if (!saved) { setSaveError("El borrador local ya no está disponible. Consulta los borradores guardados."); return; }
    const restored = normalizeDraft(saved.draft);
    setDraft(restored);
    setDraftId(saved.draft.evidenceId);
    setDraftRevision(saved.revision ?? 0);
    confirmedHash.current = undefined;
    setConfirmedSnapshot("");
    setConfirmedScope("");
    setNewIdea(saved.newIdea ?? "");
    setCauseInputs(saved.causeInputs ?? {workforce:"", machinery:"", method:"", material:"", environment:"", measurement:""});
    setStep(Math.max(0, Math.min(stepLabels.length - 1, saved.step)));
    setAiDraft(saved.aiDraft);
    setProposal(undefined);
    setSaveError("");
    if (!id || session.workspaceMode === "demo") return;
    operation.current = true; setOpening(true); setSaving(true);
    try {
      const {draft:remote} = await loadRootCauseDraft(id);
      const remoteHash = await payloadHash(remote.payload);
      const localHash = await payloadHash({step:saved.step,draft:saved.draft,aiDraft:saved.aiDraft,newIdea:saved.newIdea,causeInputs:saved.causeInputs});
      if (localHash === remoteHash) {
        confirmedHash.current = remoteHash;
        setDraftRevision(remote.revision);
        setConfirmedSnapshot(JSON.stringify({step:saved.step,draft:restored,aiDraft:saved.aiDraft,newIdea:saved.newIdea ?? "",causeInputs:saved.causeInputs ?? {workforce:"",machinery:"",method:"",material:"",environment:"",measurement:""}}));
        setConfirmedScope(JSON.stringify([id,remote.processId ?? "",remote.source,restored.relatedPartyId ?? ""]));
      } else if (saved.confirmedHash === remoteHash || remote.revision === saved.revision) {
        setDraftRevision(remote.revision);
      } else {
        setSyncError(true); setSaveError("Supabase tiene una revisión distinta. Revisa los cambios locales antes de abrir la revisión del servidor.");
      }
    } catch (error) {
      if (saved.revision || !(error instanceof RootCauseHttpError && error.status === 404)) {
        setSaveError(error instanceof Error ? error.message : "No se pudo comprobar la revisión del servidor.");
      }
    } finally {operation.current=false;setOpening(false);setSaving(false);}
  };

  useEffect(() => {
    if (loaded) {
      const hasText = step !== (stored?.currentStep ?? 0) || draft !== initialDraft || Boolean(draftRevision || saveError || aiDraft || newIdea) || Object.values(causeInputs).some(Boolean);
      if (hasText && !(stored && draft === initialDraft && draftSaved)) {
        const stored = persistence.write({step,draft,revision:draftRevision,confirmedHash:confirmedHash.current,aiDraft,newIdea,causeInputs});
        persistence.dirty(!draftSaved);
        setCacheError(stored ? "" : "El navegador no pudo conservar los cambios. Mantén abierto el editor.");
      }
    }
  }, [aiDraft, draft, draftRevision, loaded, step, storageKey, newIdea, causeInputs, initialDraft,persistence,draftSaved,stored,saveError]);


  useEffect(()=>()=>persistence.dirty(false),[persistence]);
  const responsibleIds = useMemo(() => new Set(responsibleUsers.map(user => user.id)), [responsibleUsers]);
  const completedSteps = useMemo(() => stepLabels.map((_, index) => isStepComplete(index, draft, responsibleIds)), [draft, responsibleIds]);
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
    setDraft(current => changeCause(current, id, changes));
  };

  const updatePlan = (id: string, changes: Partial<A3Analysis["plans"][number]>) => {
    setDraft((current) => ({ ...current, plans: current.plans.map((plan) => plan.id === id ? { ...plan, ...changes } : plan) }));
  };

  const resetDraft = () => {
    if (!window.confirm("Reiniciar vaciará el análisis no aprobado. Se conservarán los vínculos de evidencias del expediente.")) return;
    persistence.discard(draft.evidenceId);
    setProposal(undefined);
    setDraft(current => ({...createInitialDraft(initialClaim),evidenceId:current.evidenceId,plans:current.plans,processId:current.processId}));

    setAiDraft(undefined);
    setAiError("");
    setStep(0);
  };

  const requestAiSuggestions = async (mode:"full"|"step"="step") => {
    if (aiController.current) return;
    const controller = new AbortController();
    aiController.current = controller;
    setAiLoading(true);setAiError("");setProposal(undefined);
    requestContext.current=proposalContext(draft.problem,draft.processId,draft.evidenceId,draft.origin,draft.relatedPartyId,draft.area,draft.qualityCaseId,draft.externalClaimReference);
    const analysis=toA3Analysis(draft);requestSnapshots.current=stepLabels.map((_,i)=>stageSnapshot(analysis,i));
    try {
      const response=await fetch("/api/ai/root-cause/assist",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,step,processId:draft.processId,area:draft.area,problem:draft.problem,claimReference:draft.externalClaimReference,analysis,origin:draft.origin,...(draft.origin==="customer"&&draft.relatedPartyId?{relatedPartyId:draft.relatedPartyId}:{})})});
      const payload = await readRootCauseJson<RootCauseProposal>(response);
      if (!Array.isArray(payload.stages) || !Array.isArray(payload.documents) || !Array.isArray(payload.warnings)) throw new Error("La propuesta de IA llegó incompleta.");
      if (!controller.signal.aborted) setProposal(payload);
    }catch(error){setAiError(controller.signal.aborted ? "Espera cancelada." : error instanceof Error ? error.message : "No fue posible consultar la IA.");}finally{aiController.current=null;setAiLoading(false);}
  };
  const acceptSuggestion=(suggestion:StageSuggestion)=>{
    if (finalizing) return false;
    if(!window.confirm("¿Incorporar esta propuesta revisada como borrador de la etapa? No confirma la causa ni aprueba acciones."))return false;
    try{assertProposalContext(requestContext.current,draft.problem,draft.processId,draft.evidenceId,draft.origin,draft.relatedPartyId,draft.area,draft.qualityCaseId,draft.externalClaimReference);const currentAnalysis=toA3Analysis(draft);assertProposalSnapshots(currentAnalysis,requestSnapshots.current);const next=applyStageSuggestion(currentAnalysis,suggestion,requestSnapshots.current[suggestion.step]);
      const current = draft;
      let updated: A3Draft = {...current,...next,brainstormIds:current.brainstormIds,causeItems:current.causeItems};
      if(suggestion.step===3){
        const additions = [...new Set(next.brainstorm)].filter(text => !current.brainstorm.includes(text));
        const ideas = additions.map(text => ({ text, id: crypto.randomUUID(), sourceIdeaId: crypto.randomUUID(), category: null }));
        updated = { ...updated, brainstorm: [...current.brainstorm, ...additions], brainstormIds: [...current.brainstormIds, ...ideas.map(idea => idea.sourceIdeaId)], causeItems: [...current.causeItems, ...ideas] };
      }
      if(suggestion.step===4){
        for (const category of ishikawaCategories) {
          for (const text of next.ishikawa[category]) {
            const matches = updated.causeItems.filter(item => item.text === text);
            if (matches.some(item => item.category === category)) continue;
            if (matches.length > 1 || ishikawaCategories.some(other => other !== category && next.ishikawa[other].includes(text))) {
              throw new Error("La propuesta contiene una causa ambigua. Revisa su clasificación antes de incorporarla.");
            }
            if (matches.length) updated = changeCause(updated, matches[0].id, {category});
            else updated = {...updated, causeItems:[...updated.causeItems,{id:crypto.randomUUID(),text,category}]};
          }
        }
        updated.ishikawa = classifyCauses(updated.causeItems);
      }
      if(suggestion.step===5 && updated.rootCause !== current.rootCause) {
        updated.rootCauseCauseId = updated.rootCause.trim() ? crypto.randomUUID() : undefined;
      }
      const accepted = toA3Analysis(updated);
      requestSnapshots.current = stepLabels.map((_,i) => stageSnapshot(accepted,i));
      setDraft(updated);
      return true;
    }
    catch(error){setAiError(error instanceof Error?error.message:"No se incorporó la propuesta.");return false;}
  };

  const completeAnalysis = async () => {
    if (operation.current) return;
    const missing = getMissingFinalRequirements(draft, responsibleIds);
    if (missing.length) { setSaveError(`No se puede finalizar. Faltan: ${missing.join("; ")}.`); return; }
    const source = getCorrectiveSource(draft.origin);
    operation.current = true; setFinalizing(true);
    setSaving(true); setSaveError(""); setSyncError(false);
    try {
      const persisted = await persistDraft(step, true);
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
      persistence.discard(draft.evidenceId);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No fue posible guardar el análisis.");
    } finally { operation.current = false; setFinalizing(false); setSaving(false); }

  };

  return (
    <section className="a3-workbench">
      <header className="a3-workbench-header">
        <div><p className="module-kicker">Metodología A3</p><h3>{draftId ? "Continuar análisis de acción correctiva" : "Nuevo análisis de acción correctiva"}</h3><p>{draftSaved ? "Borrador persistido en el expediente Root2Cause." : "Guarda el borrador para continuar desde otro inicio de sesión autorizado al proceso."}</p></div>

        <div className="a3-header-actions">
          <button className="button button-ai" type="button" disabled={aiDisabled || finalizing || opening} onClick={()=>void requestAiSuggestions("full")}><Sparkles size={16}/> Llenar A3 con IA</button>
          <button className="icon-button" type="button" title="Reiniciar borrador" aria-label="Reiniciar borrador" disabled={isSaving} onClick={resetDraft}><RotateCcw size={17} /></button>
        </div>
      </header>

      {availableLocal.some(entry => !initialClaim || entry.draft.qualityCaseId === initialClaim.id && (!stored || entry.draft.evidenceId === stored.id)) && <section className="a3-stage-hint" aria-label="Continuar en este dispositivo">
        <strong>Borradores de este dispositivo</strong>
        {availableLocal.filter(entry => !initialClaim || entry.draft.qualityCaseId === initialClaim.id && (!stored || entry.draft.evidenceId === stored.id)).map(entry => <button key={entry.draft.evidenceId} type="button" className="button button-secondary" disabled={isSaving} onClick={() => resumeLocal(entry)}>
          Continuar {entry.draft.title || "análisis sin título"} · etapa {entry.step + 1}
        </button>)}
      </section>}
      {!initialClaim && session.workspaceMode !== "demo" ? <section className="a3-stage-hint" aria-label="Borradores guardados">
        <strong>Continuar un borrador guardado</strong>
        {draftListError ? <p role="alert">{draftListError}</p> : drafts.length ? <div>{drafts.map(item => <button className="button button-secondary" type="button" key={item.id} disabled={isSaving} onClick={() => void resumeSavedDraft(item.id)}>
          {item.title || "Análisis sin título"} · {item.source === "customer" ? "Externa" : item.source === "sgc" ? "SGC" : "Interna"} · etapa {item.currentStep + 1} · revisión {item.revision}
        </button>)}</div> : <p>No hay borradores guardados disponibles para tus permisos de proceso.</p>}
      </section> : null}

      <nav className="a3-stepper" aria-label="Etapas del análisis A3">
        {stepLabels.map((label, index) => (
          <button className={`${index === step ? "active" : ""} ${completedSteps[index] ? "complete" : ""}`} key={label} type="button" disabled={finalizing || opening} onClick={() => navigateToStep(index)}>
            <span>{completedSteps[index] && index !== step ? <Check size={12} /> : index + 1}</span><small>{label}</small>
          </button>
        ))}
      </nav>

      <fieldset className="a3-stage" style={{border:0,margin:0,minWidth:0}} disabled={finalizing || opening}>
        <StageHelp.Provider value={<button className="button button-secondary" type="button" disabled={aiDisabled || opening} onClick={()=>void requestAiSuggestions("step")}><Sparkles size={14}/> Ayuda IA</button>}>
        {step === 0 ? <><OpeningStage draft={draft} setDraft={setDraft} setOrigin={setOrigin} customers={customers} customerError={customerError} session={session} />{draft.origin==="customer"&&draft.relatedPartyId&&canPerformModuleAction(session,"customers","create")?<button className="button button-secondary" type="button" onClick={()=>{void claimsRequest<ClaimsCatalog>().then(setClaimEditorCatalog).catch(e=>setCustomerError((e as Error).message));}}>Registrar reclamo sin perder el avance del A3</button>:null}</> : null}
        {claimEditorCatalog?<ClaimEditor onCustomerCatalog={onCustomerCatalog} catalog={claimEditorCatalog} customerId={draft.relatedPartyId} title={draft.title} description={draft.problem} administrator={session.userType==="Administrador"} onClose={()=>setClaimEditorCatalog(null)} onSaved={async claim=>{const result=await loadRootCauseCustomers();setCustomers(result.customers);setDraft(current=>({...current,relatedPartyId:claim.external_organization_id,relatedParty:result.customers.find(c=>c.id===claim.external_organization_id)?.name??"",qualityCaseId:claim.id}));setClaimEditorCatalog(null);}}/>:null}

        {step === 1 ? <SeverityStage draft={draft} setDraft={setDraft} /> : null}
        {step === 2 ? <FiveW2HStage value={draft.fiveW2H} onChange={(fiveW2H) => setDraft((current) => ({ ...current, fiveW2H }))} /> : null}
        {step === 3 ? <BrainstormStage ideas={draft.brainstorm} ids={draft.brainstormIds} onEdit={(index, text) => setDraft(current => {
          const linked = current.causeItems.find(item => item.sourceIdeaId === current.brainstormIds[index]);
          return linked ? changeCause(current, linked.id, { text }) : { ...current, brainstorm: current.brainstorm.map((idea, i) => i === index ? text : idea) };
        })} newIdea={newIdea} setNewIdea={setNewIdea} addIdea={addIdea} /> : null}
        {step === 4 ? <IshikawaStage value={draft.ishikawa} items={draft.causeItems} inputs={causeInputs} setInputs={setCauseInputs} addCause={addCause} updateCause={updateCause} linked={id => causeInUse(draft, id)} retire={id => setDraft(current => removeCause(current, id))} /> : null}
        {step === 5 ? <CausesStage draft={draft} setDraft={setDraft} /> : null}
        {step === 6 ? <WhysStage draft={draft} setDraft={setDraft} /> : null}
        {step === 7 ? <PlansStage draft={draft} setDraft={setDraft} updatePlan={updatePlan} responsibleUsers={responsibleUsers} loadingResponsibleUsers={loadingResponsibleUsers} responsibleUsersError={responsibleUsersError} /> : null}
        <A3StepEvidence key={`${draft.evidenceId}:${step}`} evidenceId={draft.evidenceId} step={step} processId={draft.processId} persisted={Boolean(draftRevision) && confirmedScope === JSON.stringify([draft.evidenceId,draft.processId ?? "",getCorrectiveSource(draft.origin),draft.relatedPartyId ?? ""])}/>
        </StageHelp.Provider>
      </fieldset>
      {isAiLoading && <div role="status"><LoaderCircle size={15} className="spin"/> Consultando IA… <button type="button" onClick={()=>aiController.current?.abort()}>Cancelar espera</button></div>}
      {aiError && <p role="alert"><ShieldAlert size={16}/> {aiError}</p>}
      {proposal && <A3ProposalReview key={JSON.stringify(proposal)} proposal={proposal} reviewed={[]} onAccept={acceptSuggestion} onReject={()=>setProposal(undefined)}/>}

      <footer className="a3-footer">
        <button className="button button-ghost" type="button" disabled={isSaving} onClick={()=>{if(confirmLeaving())onCancel();}}>Salir al listado</button>
        <span role="status">{syncError ? (cacheError ? "Error de sincronización; cambios en el editor" : "Error de sincronización; cambios conservados en este dispositivo") : draftSaved ? "Guardado confirmado en Supabase · revisión " + draftRevision : "Cambios pendientes de guardar"}</span>
        <div>
          <button className="button button-secondary" type="button" disabled={isSaving} onClick={()=>void saveChanges()}><Save size={15}/> {isSaving ? "Guardando…" : "Guardar borrador"}</button>
          <button className="button button-secondary" type="button" disabled={step === 0 || finalizing || opening} onClick={() => navigateToStep(step - 1)}><ChevronLeft size={16} /> Anterior</button>
          {step < stepLabels.length - 1 ? <button className="button button-primary" type="button" disabled={finalizing || opening} onClick={() => navigateToStep(step + 1)}>Siguiente <ChevronRight size={16} /></button> : <button className="button button-primary" type="button" disabled={!canContinue || isSaving} onClick={() => void completeAnalysis()}><ClipboardCheck size={16} /> {isSaving ? "Guardando…" : "Crear acción A3"}</button>}

        </div>
      </footer>
      {getMissingFinalRequirements(draft, responsibleIds).length ? <details className="a3-stage-hint"><summary>Faltan estos datos para finalizar ({getMissingFinalRequirements(draft, responsibleIds).length})</summary><ul>{getMissingFinalRequirements(draft, responsibleIds).map(item => <li key={item}>{item}</li>)}</ul></details> : null}
      {cacheError && <p role="alert">{cacheError}</p>}
      {saveError ? <p role="alert">{saveError} {cacheError ? "" : "Los cambios permanecen en el editor."} {(draftId || syncError) && draft.evidenceId && <button type="button" disabled={isSaving} onClick={()=>void resumeSavedDraft(draft.evidenceId!)}>Abrir revisión de Supabase</button>}</p> : null}
    </section>
  );
}

function OpeningStage({ draft, setDraft, setOrigin, customers, customerError, session }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>>; setOrigin: (origin: A3Draft["origin"]) => void; customers: RootCauseCustomer[]; customerError: string; session: ActiveSession }) {
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
      <div className="wide"><label><span>Proceso autorizado para consulta documental</span><select value={draft.processId??""} onChange={e=>setDraft(d=>({...d,processId:e.target.value}))}><option value="">Seleccionar proceso</option>{processCatalog.filter(p=>canAccessProcess(session,p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
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

function IshikawaStage({ value, items, inputs, setInputs, addCause, updateCause, linked, retire }: { value: A3Analysis["ishikawa"]; items: NonNullable<A3Analysis["causeItems"]>; inputs: Record<IshikawaKey, string>; setInputs: React.Dispatch<React.SetStateAction<Record<IshikawaKey, string>>>; addCause: (key: IshikawaKey) => void; linked: (id: string) => boolean; retire: (id: string) => void; updateCause: (id: string, changes: Partial<NonNullable<A3Analysis["causeItems"]>[number]>) => void }) {
  const removeButton = (id: string) => <button type="button" disabled={linked(id)} title={linked(id) ? "La causa está vinculada a una conclusión o un plan" : "Retirar del Ishikawa"} onClick={() => retire(id)}>Retirar causa</button>;
  return <StageHeading icon={<GitBranch size={20} />} title="5. Ishikawa 6M" description="Las ideas anteriores aparecen como causas candidatas. Asígnalas, edítalas o cambia su categoría sin perder su relación."><div className="ishikawa-grid">{(Object.keys(ishikawaLabels) as IshikawaKey[]).map((key) => <section key={key}><h5>{ishikawaLabels[key]} <span>{value[key].length}</span></h5><div><input value={inputs[key]} onChange={(event) => setInputs((current) => ({ ...current, [key]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCause(key); } }} placeholder="Agregar causa" /><button type="button" title={`Agregar a ${ishikawaLabels[key]}`} aria-label={`Agregar a ${ishikawaLabels[key]}`} onClick={() => addCause(key)}><Plus size={14} /></button></div><ul>{items.filter(item => item.category === key).map(item => <li key={item.id}><input aria-label={`Causa en ${ishikawaLabels[key]}`} value={item.text} onChange={event => updateCause(item.id, { text: event.target.value })} /><select aria-label="Reclasificar causa" value={item.category ?? ""} onChange={event => updateCause(item.id, { category: (event.target.value || null) as IshikawaKey | null })}><option value="">Sin clasificar</option>{(Object.keys(ishikawaLabels) as IshikawaKey[]).map(category => <option key={category} value={category}>{ishikawaLabels[category]}</option>)}</select>{removeButton(item.id)}</li>)}</ul></section>)}</div><section className="a3-cause-candidates"><h5>Causas candidatas sin clasificar</h5>{items.filter(item => !item.category).map(item => <div key={item.id}><input aria-label="Causa candidata" value={item.text} onChange={event => updateCause(item.id, { text: event.target.value })} /><select aria-label="Clasificación 6M" value="" onChange={event => updateCause(item.id, { category: (event.target.value || null) as IshikawaKey | null })}><option value="">Seleccionar 6M</option>{(Object.keys(ishikawaLabels) as IshikawaKey[]).map(category => <option key={category} value={category}>{ishikawaLabels[category]}</option>)}</select>{removeButton(item.id)}</div>)}</section></StageHeading>;
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

export function PlansStage({ draft, setDraft, updatePlan, responsibleUsers, loadingResponsibleUsers, responsibleUsersError }: { draft: A3Draft; setDraft: React.Dispatch<React.SetStateAction<A3Draft>>; updatePlan: (id: string, changes: Partial<A3Analysis["plans"][number]>) => void; responsibleUsers: RootCauseResponsible[]; loadingResponsibleUsers: boolean; responsibleUsersError: string }) {
  const causes = draft.causeItems.filter(item => Boolean(item.category));
  const responsibleIds = new Set(responsibleUsers.map(user => user.id));
  return <StageHeading icon={<ClipboardCheck size={20} />} title="8. Plan de acción" description="Asigna cada acción a una M del Ishikawa y a una persona del catálogo interno." headingAction={<button className="button button-secondary" type="button" onClick={() => setDraft(current => ({ ...current, plans: appendBlankActionPlan(current.plans, crypto.randomUUID()) }))}><Plus size={15} /> Agregar acción</button>}><div className="a3-analysis-summary"><div><small>Clasificación</small><strong>{draft.origin === "customer" ? "Externa" : draft.origin === "system" ? "SGC" : "Interna"}</strong></div><div><small>Causa raíz</small><strong>{draft.rootCause}</strong></div><div><small>Causas 6M</small><strong>{causes.length}</strong></div></div><div className="a3-plan-list">{draft.plans.map((plan, index) => <section key={plan.id}><header><strong>Acción {index + 1}</strong>{draft.plans.length > 1 ? <button type="button" title="Eliminar acción" aria-label="Eliminar acción" onClick={() => setDraft(current => ({ ...current, plans: removeActionPlan(current.plans, plan.id) }))}><Trash2 size={14} /></button> : null}</header><div><label className="wide"><span>Acción correctiva</span><textarea rows={3} value={plan.description} onChange={event => updatePlan(plan.id, { description: event.target.value })} /></label><label><span>M del Ishikawa</span><select value={plan.causeCategory ?? ""} onChange={event => { const category = event.target.value as IshikawaKey | ""; const linkedCause = causes.find(item => item.id === plan.causeId); updatePlan(plan.id, { causeCategory: category || undefined, ...(linkedCause && linkedCause.category !== category ? { causeId: undefined, cause: undefined } : {}) }); }}><option value="">Seleccionar M</option>{ishikawaCategories.map(category => <option key={category} value={category}>{ishikawaLabels[category]}</option>)}</select></label><label><span>Responsable del catálogo interno</span><select value={plan.ownerUserId ?? ""} disabled={loadingResponsibleUsers} onChange={event => { const selected = responsibleUsers.find(user => user.id === event.target.value); updatePlan(plan.id, { ownerUserId: selected?.id, owner: selected?.fullName ?? "" }); }}><option value="">{loadingResponsibleUsers ? "Consultando usuarios…" : "Seleccionar responsable"}</option>{plan.ownerUserId && !responsibleIds.has(plan.ownerUserId) ? <option value={plan.ownerUserId} disabled>{plan.owner || "Responsable guardado no disponible"}</option> : null}{responsibleUsers.map(user => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select>{plan.owner && !plan.ownerUserId ? <small>Responsable guardado: {plan.owner}. Selecciona una cuenta del catálogo para validar la asignación.</small> : null}</label><label><span>Fecha compromiso</span><input type="date" value={plan.dueDate} onChange={event => updatePlan(plan.id, { dueDate: event.target.value })} /></label></div></section>)}</div>{responsibleUsersError ? <p role="alert">{responsibleUsersError}</p> : null}{!loadingResponsibleUsers && !responsibleUsers.length && !responsibleUsersError ? <p className="a3-stage-hint">No hay usuarios internos autorizados disponibles en el catálogo de esta organización.</p> : null}</StageHeading>;
}

function StageHeading({ icon, title, description, children, headingAction }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode; headingAction?: React.ReactNode }) {
  const help = useContext(StageHelp);
  return <section className="a3-stage-content"><header><span>{icon}</span><div><h4>{title}</h4><p>{description}</p></div>{help}{headingAction}</header>{children}</section>;
}

function isStepComplete(step: number, draft: A3Draft, responsibleIds: ReadonlySet<string> = new Set()) {
  switch (step) {
    case 0: return Boolean(draft.title.trim() && draft.problem.trim().length >= 15 && (draft.area.trim() || draft.processId) && draft.owner.trim() && draft.dueDate && (draft.origin !== "customer" || draft.relatedPartyId) && (draft.origin !== "system" || draft.processId));
    case 1: return Boolean(draft.severity && draft.severityJustification.trim());
    case 2: return Object.values(draft.fiveW2H).every((value) => value.trim());
    case 3: return draft.brainstorm.length >= 3;
    case 4: return draft.causeItems.filter(item => item.category).length >= 3;
    case 5: return Boolean(draft.nonDetectionCause.trim() && draft.rootCause.trim());
    case 6: return draft.nonDetectionWhys.filter((value) => value.trim()).length >= 3 && draft.rootCauseWhys.filter((value) => value.trim()).length >= 3;
    case 7: return draft.plans.length > 0 && draft.plans.every((plan) => isActionPlanReady(plan, responsibleIds));
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

function getMissingFinalRequirements(draft: A3Draft, responsibleIds: ReadonlySet<string> = new Set()): string[] {
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
    if (!plan.causeCategory) missing.push(`${prefix}: categoría M del Ishikawa`);
    if (!plan.ownerUserId || !responsibleIds.has(plan.ownerUserId)) missing.push(`${prefix}: responsable del catálogo interno`);
    if (!plan.dueDate) missing.push(`${prefix}: fecha compromiso`);
  });
  return missing;
}
