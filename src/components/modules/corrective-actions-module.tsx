"use client";
import "./corrective-actions.css";
import { A3PortalPublication } from "./a3-portal-publication";
import { A3PlanFollowup } from "./a3-plan-followup";
import { useContinuityState } from "@/components/workspace-continuity";
import { confirmLeaving } from "@/lib/workspace-continuity";

import {
  AlertTriangle,
  Archive,
  Bot,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Filter,
  ListChecks,
  NotebookPen,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  A3AnalysisWorkbench,
  type A3Submission,
} from "@/components/modules/a3-analysis-workbench";
import { A3ActionReport } from "@/components/modules/a3-action-report";
import { matchesCorrectiveListScope, type CorrectiveListScope } from "@/lib/corrective-action-list";
import { RetiredCorrectiveActions } from "@/components/modules/retired-corrective-actions";
import { AiSuggestionResult } from "@/components/modules/ai-suggestion-result";
import type { CustomerClaim } from "@/lib/customer-claims";

import { buildRootCauseAiRequest } from "@/lib/ai-context";
import {
  canEditCorrectiveAction,
  canViewCorrectiveAction,
} from "@/lib/corrective-action-access";
import {
  getCorrectiveActionLabel,
  isCorrectiveActionOverdue,
  toIsoDate,
} from "@/lib/domain";
import { canPerformModuleAction } from "@/lib/module-permissions";
import { canHardDeleteCorrectiveAction } from "@/lib/root2cause/hard-delete";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";
import { publishCorrectiveAction, saveCorrectiveAction, softDeleteDemoCorrectiveAction, softDeleteStoredCorrectiveAction, unpublishCorrectiveAction } from "@/lib/root-cause-publication";
import { finalizeRootCauseDraft } from "@/lib/root-cause-draft-storage";
import type {
  AiRootCauseDraft,
  CorrectiveAction,
  CorrectiveActionStatus,
} from "@/lib/types";

interface CorrectiveActionsModuleProps {
  claimSeed?: CustomerClaim;
  onClaimSeedClear?: () => void;
  onNavigateCustomers?: () => void;
  actions: CorrectiveAction[];
  focusId?: string;
  onActionsChange: (actions: CorrectiveAction[]) => void;
  session: ActiveSession;
}

type CorrectiveWorkspaceView = "lists" | "a3" | "retired" | "followup";
type CorrectiveRegistryView = "index" | "report";

const statusOrder: CorrectiveActionStatus[] = [
  "open",
  "analysis",
  "action_plan",
  "implementation",
  "effectiveness",
  "closed",
];

export function CorrectiveActionsModule({
  actions,
  focusId,
  onActionsChange,
  session,
  claimSeed,
  onClaimSeedClear,
  onNavigateCustomers,
}: CorrectiveActionsModuleProps) {
  const today = toIsoDate(new Date());
  const focusedAction = actions.find((action) => action.id === focusId && action.source !== "supplier");
  const [selectedId, setSelectedId] = useContinuityState("root2cause:selected",focusedAction?.id ?? actions[0]?.id ?? "");
  const [query, setQuery] = useContinuityState("root2cause:query","");
  const [statusFilter, setStatusFilter] = useContinuityState("root2cause:status","all");
  const [workspaceView, setWorkspaceView] = useState<CorrectiveWorkspaceView>(claimSeed ? "a3" : "lists");
  const [listScope, setListScope] = useContinuityState<CorrectiveListScope>("root2cause:scope",
    focusedAction?.source === "customer"
      ? "customer"
      : focusedAction?.source === "audit" || focusedAction?.source === "sgc"
        ? "system"
        : focusedAction
          ? "internal"
          : "all",
  );
  const [savedGroup, setGroup] = useContinuityState<"all" | "open" | "closed" | "legacy">("root2cause:state-group","legacy");
  // Earlier sessions stored either an origin or an open/closed filter in the same key.
  const legacyGroup = listScope === "open" || listScope === "closed" ? listScope : "all";
  const group = savedGroup === "legacy" ? (statusFilter === "closed" ? "closed" : legacyGroup) : savedGroup;
  const phase = statusFilter === "closed" || group === "closed" ? "all" : statusFilter;
  const origin = listScope === "open" || listScope === "closed" ? "all" : listScope;
  const [registryView, setRegistryView] = useState<CorrectiveRegistryView>(focusedAction ? "report" : "index");
  const [isAiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [publicationError, setPublicationError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState("");
  const [hardDeleteCandidateId, setHardDeleteCandidateId] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteFolioConfirmation, setDeleteFolioConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [hardDeleteContractEnabled, setHardDeleteContractEnabled] = useState(false);
  const canCreate = canPerformModuleAction(
    session,
    "corrective-actions",
    "create",
  );
  const hasHardDeletePermission = canHardDeleteCorrectiveAction(session);
  const hardDeleteEnabled = hardDeleteContractEnabled && hasHardDeletePermission && session.workspaceMode !== "demo";
  useEffect(() => {
    if (!hasHardDeletePermission || session.workspaceMode === "demo") return;
    let active = true;
    void fetch("/api/root2cause/hard-delete-capabilities", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ enabled?: boolean }> : { enabled: false })
      .then((result) => { if (active) setHardDeleteContractEnabled(result.enabled === true); })
      .catch(() => { if (active) setHardDeleteContractEnabled(false); });
    return () => { active = false; };
  }, [hasHardDeletePermission, session.workspaceMode]);

  const rootCauseActions = useMemo(
    () => actions.filter(
      (action) =>
        !action.deletedAt && action.source !== "supplier" && canViewCorrectiveAction(session, action),
    ),
    [actions, session],
  );
  const originActions = useMemo(() => rootCauseActions.filter(action => matchesCorrectiveListScope(action, origin)), [rootCauseActions, origin]);
  const closedCount = originActions.filter(action => action.status === "closed").length;
  const filteredActions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return originActions.filter((action) => {
      const matchesQuery =
        !normalizedQuery ||
        [action.folio, action.a3?.descriptiveTitle ?? action.title, action.area, action.owner].some((value) =>
          value.toLocaleLowerCase("es").includes(normalizedQuery),
        );
      const matchesStatus =
        phase === "all" ||
        action.status === phase ||
        (phase === "overdue" &&
          isCorrectiveActionOverdue(action, today));
      const matchesScope = matchesCorrectiveListScope(action, group);
      return matchesQuery && matchesStatus && matchesScope;
    });
  }, [group, query, originActions, phase, today]);

  const selected = rootCauseActions.find(action => action.id === selectedId);
  const canEditSelected = selected
    ? canEditCorrectiveAction(session, selected)
    : false;

  const updateSelected = (changes: Partial<CorrectiveAction>) => {
    if (!selected || !canEditSelected) return;
    const updated = { ...selected, ...changes, portalVisible: selected.portalVisible && session.workspaceMode !== "demo" ? false : selected.portalVisible };
    const apply = () => onActionsChange(actions.map(action => action.id === selected.id ? updated : action));
    if (session.workspaceMode !== "demo" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(updated.id) && updated.a3) {
      void saveCorrectiveAction(updated).then(apply).catch(error => setPublicationError(error instanceof Error ? error.message : "No fue posible guardar los cambios."));
    } else apply();
  };

  const requestAiAnalysis = async () => {
    if (!selected) {
      return;
    }

    setAiLoading(true);
    setAiError("");
    try {
      const response = await fetch("/api/ai/root-cause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildRootCauseAiRequest({
            title: selected.title,
            problem: selected.problem,
            source: selected.source,
            severity: selected.severity,
            area: selected.area,
            owner: selected.owner,
            relatedParty: selected.relatedParty,
            analysis: selected.a3,
          }),
        ),
      });

      const payload = (await response.json()) as AiRootCauseDraft & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible analizar el problema.");
      }

      const currentStatusIndex = statusOrder.indexOf(selected.status);
      updateSelected({
        aiDraft: payload,
        ...(currentStatusIndex < statusOrder.indexOf("analysis")
          ? { status: "analysis" as const, progress: Math.max(35, selected.progress) }
          : {}),
      });
    } catch (error) {
      setAiError(
        error instanceof Error
          ? error.message
          : "No fue posible consultar el análisis.",
      );
    } finally {
      setAiLoading(false);
    }
  };

  const completeA3Analysis = async (values: A3Submission) => {
    const nextNumber = Math.max(0, ...actions.map(action => Number(action.folio.match(/^AC-(\d{6})$/)?.[1] ?? 0))) + 1;
    const finalized = session.workspaceMode !== "demo" ? await finalizeRootCauseDraft(values.draftId, values.draftRevision) : null;
    const action: CorrectiveAction = {
      ...values,
      // Evidence links use the plan ID selected in the workbench.
      a3: values.a3,
      id: finalized?.id ?? values.draftId,
      folio: finalized?.folio ?? `AC-${String(nextNumber).padStart(6, "0")}`,
      title: finalized?.title ?? `AC-${String(nextNumber).padStart(6, "0")}`,
      createdAt: today,
      status: "action_plan",
      progress: 55,
      evidenceCount: 0,
      rootCause: values.a3.rootCause,
      ownerId: session.authUserId,
      participantUserIds: [session.authUserId ?? session.userId],
      organizationId: session.organizationId,
      externalReference: values.externalClaimReference,
      relatedPartyId: values.relatedPartyId,
      qualityCaseId: values.qualityCaseId,
      portalVisible: false,
    };

    const persisted = action;
    onActionsChange([persisted, ...actions.filter(item => item.id !== persisted.id)]);
    setSelectedId(action.id);
    setListScope(
      action.source === "customer"
        ? "customer"
        : action.source === "audit" || action.source === "sgc"
          ? "system"
          : "internal",
    );
    setWorkspaceView("lists");
    setRegistryView("report");
  };

  const publishSelected = async (files: string[] = []) => {
    if (!selected || !isAdministrator(session) || selected.source !== "customer") return;
    setPublishing(true); setPublicationError("");
    try {
      await publishCorrectiveAction(selected,files);
      onActionsChange(actions.map(action => action.id === selected.id ? { ...action, portalVisible: true } : action));
    } catch (error) { setPublicationError(error instanceof Error ? error.message : "No fue posible publicar el análisis."); }
    finally { setPublishing(false); }
  };

  const unpublishSelected = async () => {
    if (!selected || !isAdministrator(session)) return;
    setPublishing(true); setPublicationError("");
    try {
      await unpublishCorrectiveAction(selected.id);
      onActionsChange(actions.map(action => action.id === selected.id ? { ...action, portalVisible: false } : action));
    } catch (error) { setPublicationError(error instanceof Error ? error.message : "No fue posible retirar la publicación."); }
    finally { setPublishing(false); }
  };

  const deleteCandidate = actions.find(action => action.id === deleteCandidateId);
  const hardDeleteCandidate = actions.find(action => action.id === hardDeleteCandidateId);
  const requestHardDelete = (action: CorrectiveAction) => {
    if (!hardDeleteEnabled || !hasHardDeletePermission || session.workspaceMode === "demo") return;
    setHardDeleteCandidateId(action.id);
    setDeleteReason("");
    setDeleteFolioConfirmation("");
    setDeleteError("");
  };
  const confirmHardDelete = async () => {
    if (!hardDeleteCandidate || !hardDeleteEnabled || !hasHardDeletePermission ||
      session.workspaceMode === "demo" || !deleteReason.trim() ||
      deleteFolioConfirmation !== hardDeleteCandidate.folio) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/root2cause/actions/${encodeURIComponent(hardDeleteCandidate.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folio: hardDeleteCandidate.folio,
          reason: deleteReason.trim(),
          folioConfirmation: deleteFolioConfirmation,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "No fue posible confirmar la eliminación.");
      onActionsChange(actions.filter((action) => action.id !== hardDeleteCandidate.id));
      setHardDeleteCandidateId("");
      setDeleteReason("");
      setDeleteFolioConfirmation("");
      setSelectedId("");
      setRegistryView("index");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "No fue posible eliminar la acción correctiva.");
    } finally {
      setDeleting(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleteCandidate || !isAdministrator(session) || session.workspaceMode === "demo" || !deleteReason.trim()) return;
    setDeleting(true); setDeleteError("");
    try {
      const example = ["ca-001", "ca-002", "ca-003"].includes(deleteCandidate.id);
      const retirement = example ? await softDeleteDemoCorrectiveAction(deleteCandidate.id, deleteReason.trim()) : null;
      if (!example) await softDeleteStoredCorrectiveAction(deleteCandidate.id, deleteReason.trim());
      onActionsChange(actions.map(action => action.id === deleteCandidate.id ? {
        ...action, deletedAt: retirement?.deletedAt ?? new Date().toISOString(), deletedBy: retirement?.deletedBy ?? session.authUserId ?? session.userId,
        deletionReason: deleteReason.trim(), portalVisible: false,
      } : action));
      setDeleteCandidateId(""); setDeleteReason(""); setSelectedId(""); setRegistryView("index");
    } catch (error) { setDeleteError(error instanceof Error ? error.message : "No fue posible borrar el análisis."); }
    finally { setDeleting(false); }
  };

  const views = [
    { id: "lists", label: "Acciones correctivas", icon: ClipboardList, visible: true },
    { id: "a3", label: "Análisis A3", icon: NotebookPen, visible: canCreate || Boolean(claimSeed?.linkedDraftIds?.length) },
    { id: "followup", label: "Seguimiento de acciones", icon: ListChecks, visible: session.workspaceMode !== "demo" && canPerformModuleAction(session, "corrective-actions", "view") },
    { id: "retired", label: "Registros retirados", icon: Archive, visible: isAdministrator(session) && session.workspaceMode !== "demo" },
  ] as const;

  return (
    <>
      <section className="module-heading"><div><p className="module-kicker">CAPA</p><h2>Root2Cause</h2></div></section>
      <nav className="quality-view-tabs rootcause-view-tabs" aria-label="Vistas de Root2Cause">
        {views.filter(view => view.visible).map(({id, label, icon: Icon}) => (
          <button key={id} type="button" className={workspaceView === id ? "active" : ""} aria-current={workspaceView === id ? "page" : undefined}
            onClick={() => {
              if (workspaceView !== id && !confirmLeaving()) return;
              setWorkspaceView(id);
              if (id === "lists") setRegistryView("index");
            }}>
            <Icon size={16} aria-hidden="true" />{label}
          </button>
        ))}
      </nav>

      {workspaceView === "followup" && <A3PlanFollowup key={session.authUserId} actions={rootCauseActions} openPlan={id=>{
        const action = rootCauseActions.find(a=>a.a3?.plans.some(plan=>plan.id===id));
        if (!action) return;
        return () => {setQuery("");setStatusFilter("all");setSelectedId(action.id);
          setListScope(action.source==="customer"?"customer":action.source==="sgc"||action.source==="audit"?"system":"internal");
          setWorkspaceView("lists");setRegistryView("report");};
      }} write={canPerformModuleAction(session,"corrective-actions","update")} quality={isAdministrator(session)}/>}
      {workspaceView === "retired" && isAdministrator(session) && session.workspaceMode !== "demo" ? <RetiredCorrectiveActions onActionsChange={onActionsChange} /> : null}
      {workspaceView === "lists" ? (
        <>
          {registryView === "index" && <>
            <div className="metric-grid corrective-summary" role="group" aria-label="Filtrar acciones por estado">
              {([
                ["all", "Todas las acciones vigentes", originActions.length, ClipboardList, "neutral"],
                ["open", "Acciones abiertas", originActions.length - closedCount, CircleDot, "warning"],
                ["closed", "Acciones cerradas", closedCount, CheckCircle2, "success"],
              ] as const).map(([id, label, count, Icon, tone]) => (
                <button key={id} type="button" aria-pressed={group === id} className={"metric metric-action metric-" + tone}
                  onClick={() => { setGroup(id); setStatusFilter("all"); }}>
                  <div className="metric-icon"><Icon aria-hidden="true" size={18}/></div>
                  <div><strong>{count}</strong><span>{label}</span></div>
                </button>
              ))}
            </div>
            <div className="corrective-origins" role="group" aria-label="Filtrar acciones por origen">
              {([["all","Todas"],["internal","Internas"],["customer","Externas / Clientes"],["system","Sistema de gestión"]] as const).map(([id,label]) => (
                <button type="button" key={id} aria-pressed={origin === id} className="button button-secondary"
                  onClick={() => { setGroup(group); setListScope(id); }}>{label}</button>
              ))}
            </div>
          </>}
          <section className={`corrective-registry-layout corrective-registry-${registryView}`}>
        {registryView === "index" ? <div className="records-panel">
          <div className="panel-toolbar">
            <label className="panel-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar acción"
                aria-label="Buscar acción"
              />
            </label>
            {group !== "closed" && <label className="filter-control">
              <Filter size={15} />
              <select
                aria-label="Filtrar por etapa o vencimiento"
                value={phase}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">Todas las etapas</option>
                <option value="overdue">Vencidas</option>
                {statusOrder.filter(status => status !== "closed").map((status) => (
                  <option key={status} value={status}>
                    {getCorrectiveActionLabel(status)}
                  </option>
                ))}
              </select>
            </label>}
          </div>

          <div className="records-count">
            {filteredActions.length}{" "}
            {filteredActions.length === 1 ? "registro" : "registros"}
          </div>

          {filteredActions.length ? <div className="quality-table-wrap">
            <table className="quality-table corrective-action-table" aria-label="Acciones correctivas vigentes">
              <thead><tr><th scope="col">Expediente</th><th scope="col">Responsable</th><th scope="col">Compromiso</th><th scope="col">Estado</th><th scope="col">Avance</th><th scope="col">Acciones</th></tr></thead>
              <tbody>{filteredActions.map(action => {
                const overdue = isCorrectiveActionOverdue(action, today);
                return <tr key={action.id}>
                  <td><code>{action.folio}</code><strong>{action.a3?.descriptiveTitle || action.title}</strong><small>{action.area}</small></td>
                  <td data-label="Responsable">{action.owner}</td>
                  <td data-label="Compromiso">{formatDate(action.dueDate)}</td>
                  <td data-label="Estado"><span className={"status-badge " + (overdue ? "status-danger" : "status-" + action.status)}>{overdue ? "Vencida" : getCorrectiveActionLabel(action.status)}</span></td>
                  <td data-label="Avance">{action.progress}%</td>
                  <td><div className="corrective-row-actions">
                    <button className="button button-secondary" type="button" aria-label={"Abrir " + action.folio} onClick={() => {setSelectedId(action.id); setRegistryView("report");}}>Abrir</button>
                    {hardDeleteEnabled && hasHardDeletePermission && <button className="icon-button danger" type="button" title="Eliminar definitivamente" aria-label={"Eliminar definitivamente " + action.folio} onClick={() => requestHardDelete(action)}><Trash2 size={16}/></button>}
                  </div></td>
                </tr>;
              })}</tbody>
            </table>
          </div> : <p className="corrective-empty" role="status">Sin acciones para esta consulta.</p>}
        </div> : null}

        {registryView === "report" && !selected && <div className="access-empty"><p>El expediente ya no está disponible en tu listado.</p><button type="button" className="button button-secondary" onClick={()=>setRegistryView("index")}>Volver al listado</button></div>}
        {registryView === "report" && selected ? <article className="corrective-report-view">
          <A3ActionReport action={selected} session={session} onBack={() => setRegistryView("index")}>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                const currentIndex = statusOrder.indexOf(selected.status);
                const nextStatus = statusOrder[Math.min(currentIndex + 1, statusOrder.length - 1)];
                updateSelected({ status: nextStatus, progress: Math.min(100, selected.progress + 18) });
              }}
              disabled={!canEditSelected || selected.status === "closed"}
            >
              <CheckCircle2 size={16} /> Avanzar etapa
            </button>
            {isAdministrator(session) && selected.source === "customer" && session.workspaceMode !== "demo" ?
              <A3PortalPublication key={selected.id + ":" + selected.portalVisible} action={selected} busy={publishing}
                onPublish={ids=>void publishSelected(ids)} onWithdraw={()=>void unpublishSelected()}/> :
              isAdministrator(session) && selected.source === "customer" ? <button className="button button-secondary" type="button" disabled={publishing || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(selected.relatedPartyId ?? "")} onClick={() => void (selected.portalVisible ? unpublishSelected() : publishSelected())}>{selected.portalVisible ? "Retirar del portal" : "Autorizar publicación"}</button> : null }

            {hardDeleteEnabled && hasHardDeletePermission ? <button className="button button-secondary danger" type="button" onClick={() => requestHardDelete(selected)} title="Eliminar definitivamente"><Trash2 size={16} /> Eliminar definitivamente</button> : null}
            {isAdministrator(session) && session.workspaceMode !== "demo" && (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(selected.id) || ["ca-001", "ca-002", "ca-003"].includes(selected.id)) ? <button className="button button-secondary" type="button" onClick={() => { setDeleteCandidateId(selected.id); setDeleteReason(""); setDeleteError(""); }}><Trash2 size={16} /> Borrar</button> : null}
          </A3ActionReport>
          {selected.source === "customer" && isAdministrator(session) && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(selected.relatedPartyId ?? "") ? <p role="status">Para publicar, vincula primero un cliente real del catálogo.</p> : null}
          {publicationError ? <p role="alert">{publicationError}</p> : null}
          <div className="ai-workbench">
            <div className="ai-workbench-heading">
              <div className="ai-icon">
                <Sparkles size={18} />
              </div>
              <div>
                <div className="section-title-row compact">
                  <h4>Asistente de causa raíz</h4>
                  {selected.aiDraft ? (
                    <span className="mode-badge">
                      {selected.aiDraft.mode === "external"
                        ? "IA conectada"
                        : "Borrador local"}
                    </span>
                  ) : null}
                </div>
                <p>
                  Analiza la descripción integral, el expediente A3 y los documentos autorizados del proceso.
                </p>
              </div>
              <button
                className="button button-ai"
                type="button"
                onClick={requestAiAnalysis}
                disabled={!canEditSelected || isAiLoading}
              >
                {isAiLoading ? (
                  <LoaderCircle className="spin" size={16} />
                ) : selected.aiDraft ? (
                  <RefreshCw size={16} />
                ) : (
                  <Bot size={16} />
                )}
                {selected.aiDraft ? "Regenerar" : "Analizar"}
              </button>
            </div>

            {aiError ? (
              <div className="inline-error">
                <ShieldAlert size={16} />
                {aiError}
              </div>
            ) : null}

            {selected.aiDraft ? (
              <AiSuggestionResult
                draft={selected.aiDraft}
                onUseRootCause={canEditSelected ? (rootCause) => updateSelected({ rootCause }) : undefined}
              />
            ) : (
              <div className="ai-empty">
                <CircleDot size={18} />
                <span>El análisis aún no se ha iniciado.</span>
              </div>
            )}
          </div>

        </article> : null}
          </section>
        </>
      ) : workspaceView === "a3" && (canCreate || claimSeed?.linkedDraftIds?.length) ? (
        <A3AnalysisWorkbench
          initialClaim={claimSeed}
          onCustomerCatalog={onNavigateCustomers}
          onCancel={() => {setWorkspaceView("lists");onClaimSeedClear?.();}}
          onComplete={async values=>{await completeA3Analysis(values);onClaimSeedClear?.();}}
          session={session}
        />
      ) : null}
      {deleteCandidate ? <div className="corrective-delete-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-label="Confirmar borrado de análisis"><h3>Borrar {deleteCandidate.folio}</h3><p>{deleteCandidate.title}</p><p>{deleteCandidate.problem}</p><p>Relaciones: {deleteCandidate.relatedPartyId ? "cliente vinculado; " : ""}{deleteCandidate.qualityCaseId ? "reclamación vinculada; " : ""}{deleteCandidate.a3?.plans.length ?? 0} acciones y {deleteCandidate.evidenceCount} evidencias. Se conservarán los archivos y el historial.</p><label>Motivo del borrado<input value={deleteReason} onChange={event => setDeleteReason(event.target.value)} required /></label>{deleteError ? <p role="alert">{deleteError}</p> : null}<div><button className="button button-secondary" type="button" onClick={() => setDeleteCandidateId("")}>Cancelar</button><button className="button button-primary" type="button" disabled={!deleteReason.trim() || deleting} onClick={() => void confirmDelete()}>{deleting ? "Guardando…" : "Confirmar borrado lógico"}</button></div></section></div> : null}
      {hardDeleteCandidate ? <div className="modal-backdrop" role="presentation"><section className="modal modal-compact" role="dialog" aria-modal="true" aria-labelledby="root2cause-hard-delete-title">
        <h3 id="root2cause-hard-delete-title">Eliminar acción correctiva definitivamente</h3>
        <dl><div><dt>Código AC</dt><dd>{hardDeleteCandidate.folio}</dd></div><div><dt>Tipo</dt><dd>{hardDeleteCandidate.source === "customer" ? "Externa" : hardDeleteCandidate.source === "audit" || hardDeleteCandidate.source === "sgc" ? "SGC" : "Interna"}</dd></div><div><dt>Cliente o proceso</dt><dd>{hardDeleteCandidate.relatedParty || hardDeleteCandidate.relatedPartyId || hardDeleteCandidate.processId || hardDeleteCandidate.area || "No especificado"}</dd></div></dl>
        <p className="inline-warning"><AlertTriangle size={16} /> La eliminación es irreversible. El servidor bloqueará expedientes con referencias compartidas o de otros módulos.</p>
        <label><span>Motivo de eliminación</span><textarea rows={3} maxLength={1000} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} disabled={deleting} required /></label>
        <label><span>Escribe exactamente {hardDeleteCandidate.folio} para confirmar</span><input value={deleteFolioConfirmation} onChange={(event) => setDeleteFolioConfirmation(event.target.value)} disabled={deleting} autoComplete="off" /></label>
        {deleteError ? <p role="alert" className="inline-error"><ShieldAlert size={16} />{deleteError}</p> : null}
        <div className="modal-actions"><button className="button button-secondary" type="button" disabled={deleting} onClick={() => setHardDeleteCandidateId("")}>Cancelar</button><button className="button button-danger" type="button" disabled={deleting || !deleteReason.trim() || deleteFolioConfirmation !== hardDeleteCandidate.folio || !hardDeleteEnabled || !hasHardDeletePermission} onClick={() => void confirmHardDelete()}>{deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}Eliminar definitivamente</button></div>
      </section></div> : null}
    </>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}
