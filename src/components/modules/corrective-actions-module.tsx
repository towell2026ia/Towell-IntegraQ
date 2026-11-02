"use client";

import {
  AlertTriangle,
  BookOpen,
  Bot,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardList,
  ExternalLink,
  FileCheck2,
  Filter,
  LoaderCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  A3AnalysisWorkbench,
  type A3Submission,
} from "@/components/modules/a3-analysis-workbench";
import { A3ActionReport } from "@/components/modules/a3-action-report";
import { AiSuggestionResult } from "@/components/modules/ai-suggestion-result";

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
import { isAdministrator, type ActiveSession } from "@/lib/session-data";
import { publishCorrectiveAction, saveCorrectiveAction, softDeleteStoredCorrectiveAction, unpublishCorrectiveAction } from "@/lib/root-cause-publication";
import type {
  AiRootCauseDraft,
  CorrectiveAction,
  CorrectiveActionStatus,
} from "@/lib/types";

interface CorrectiveActionsModuleProps {
  actions: CorrectiveAction[];
  focusId?: string;
  onActionsChange: (actions: CorrectiveAction[]) => void;
  session: ActiveSession;
}

type CorrectiveWorkspaceView = "lists" | "a3";
type CorrectiveListScope = "open" | "customer" | "internal" | "system";
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
}: CorrectiveActionsModuleProps) {
  const today = toIsoDate(new Date());
  const focusedAction = actions.find((action) => action.id === focusId && action.source !== "supplier");
  const [selectedId, setSelectedId] = useState(focusedAction?.id ?? actions[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [workspaceView, setWorkspaceView] = useState<CorrectiveWorkspaceView>("lists");
  const [listScope, setListScope] = useState<CorrectiveListScope>(
    focusedAction?.source === "customer"
      ? "customer"
      : focusedAction?.source === "audit" || focusedAction?.source === "sgc"
        ? "system"
        : focusedAction
          ? "internal"
          : "open",
  );
  const [registryView, setRegistryView] = useState<CorrectiveRegistryView>("index");
  const [isAiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [publicationError, setPublicationError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const canCreate = canPerformModuleAction(
    session,
    "corrective-actions",
    "create",
  );

  const rootCauseActions = useMemo(
    () => actions.filter(
      (action) =>
        !action.deletedAt && action.source !== "supplier" && canViewCorrectiveAction(session, action),
    ),
    [actions, session],
  );
  const filteredActions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return rootCauseActions.filter((action) => {
      const matchesQuery =
        !normalizedQuery ||
        [action.folio, action.title, action.area, action.owner].some((value) =>
          value.toLocaleLowerCase("es").includes(normalizedQuery),
        );
      const matchesStatus =
        statusFilter === "all" ||
        action.status === statusFilter ||
        (statusFilter === "overdue" &&
          isCorrectiveActionOverdue(action, today));
      const matchesScope =
        (listScope === "open" && action.status !== "closed") ||
        (listScope === "customer" && action.source === "customer") ||
        (listScope === "internal" && action.source === "internal") ||
        (listScope === "system" && (action.source === "audit" || action.source === "sgc"));
      return matchesQuery && matchesStatus && matchesScope;
    });
  }, [listScope, query, rootCauseActions, statusFilter, today]);

  const selected =
    filteredActions.find((action) => action.id === selectedId) ??
    filteredActions[0] ??
    rootCauseActions[0];
  const canEditSelected = selected
    ? canEditCorrectiveAction(session, selected)
    : false;

  const metrics = useMemo(
    () => ({
      active: rootCauseActions.filter((action) => action.status !== "closed").length,
      overdue: rootCauseActions.filter((action) =>
        isCorrectiveActionOverdue(action, today),
      ).length,
      effectiveness: rootCauseActions.filter(
        (action) => action.status === "effectiveness",
      ).length,
      closed: rootCauseActions.filter((action) => action.status === "closed").length,
    }),
    [rootCauseActions, today],
  );

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
    const year = today.slice(0, 4);
    const nextNumber =
      Math.max(
        0,
        ...actions.filter(action => action.folio.startsWith(`AC-${year}-`)).map((action) => Number(action.folio.split("-").at(-1)) || 0),
      ) + 1;
    const action: CorrectiveAction = {
      ...values,
      a3: { ...values.a3, plans: values.a3.plans.map(plan => ({ ...plan, id: crypto.randomUUID() })) },
      id: crypto.randomUUID(),
      folio: `AC-${year}-${String(nextNumber).padStart(3, "0")}`,
      createdAt: today,
      status: "action_plan",
      progress: 55,
      evidenceCount: 0,
      rootCause: values.a3.rootCause,
      ownerId: session.authUserId,
      participantUserIds: [session.authUserId ?? session.userId],
      relatedPartyId: values.relatedPartyId,
      qualityCaseId: values.qualityCaseId,
      portalVisible: false,
    };

    if (session.workspaceMode !== "demo") await saveCorrectiveAction(action);
    onActionsChange([action, ...actions]);
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

  const publishSelected = async () => {
    if (!selected || !isAdministrator(session) || selected.source !== "customer") return;
    setPublishing(true); setPublicationError("");
    try {
      await publishCorrectiveAction(selected);
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
  const confirmDelete = async () => {
    if (!deleteCandidate || !isAdministrator(session) || !deleteReason.trim()) return;
    setDeleting(true); setDeleteError("");
    try {
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(deleteCandidate.id) && session.workspaceMode !== "demo") {
        await softDeleteStoredCorrectiveAction(deleteCandidate.id, deleteReason.trim());
      }
      onActionsChange(actions.map(action => action.id === deleteCandidate.id ? {
        ...action, deletedAt: new Date().toISOString(), deletedBy: session.authUserId ?? session.userId,
        deletionReason: deleteReason.trim(), portalVisible: false,
      } : action));
      setDeleteCandidateId(""); setDeleteReason(""); setSelectedId(""); setRegistryView("index");
    } catch (error) { setDeleteError(error instanceof Error ? error.message : "No fue posible borrar el análisis."); }
    finally { setDeleting(false); }
  };

  const selectListScope = (scope: CorrectiveListScope) => {
    setListScope(scope);
    setRegistryView("index");
  };

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">CAPA</p>
          <h2>Root2Cause</h2>
          <p>
            Listados por origen y análisis A3 desde la detección hasta la eficacia.
          </p>
        </div>
        {canCreate ? <button className="button button-primary" type="button" onClick={() => setWorkspaceView("a3")}>
          <Plus size={17} />
          Iniciar análisis A3
        </button> : null}
      </section>

      <section className="metric-grid" aria-label="Resumen de acciones">
        <Metric
          icon={<ClipboardList size={19} />}
          label="Acciones activas"
          value={metrics.active}
          tone="neutral"
        />
        <Metric
          icon={<AlertTriangle size={19} />}
          label="Vencidas"
          value={metrics.overdue}
          tone="danger"
        />
        <Metric
          icon={<FileCheck2 size={19} />}
          label="Validando eficacia"
          value={metrics.effectiveness}
          tone="warning"
        />
        <Metric
          icon={<CheckCircle2 size={19} />}
          label="Cerradas"
          value={metrics.closed}
          tone="success"
        />
      </section>

      <div className="quality-view-tabs corrective-main-tabs" aria-label="Vistas de Root2Cause">
        <button className={workspaceView === "lists" ? "active" : ""} type="button" onClick={() => setWorkspaceView("lists")}><BookOpen size={15} /> Listados de acciones</button>
        {canCreate ? <button className={workspaceView === "a3" ? "active" : ""} type="button" onClick={() => setWorkspaceView("a3")}><ClipboardList size={15} /> Análisis A3</button> : null}
      </div>

      {workspaceView === "lists" ? (
        <>
          <section className="corrective-list-menu" aria-label="Listados por origen">
            <button className={listScope === "open" ? "active" : ""} type="button" onClick={() => selectListScope("open")}><ClipboardList size={18} /><span><strong>Acciones abiertas</strong><small>{rootCauseActions.filter((action) => action.status !== "closed").length} registros activos</small></span></button>
            <button className={listScope === "customer" ? "active" : ""} type="button" onClick={() => selectListScope("customer")}><ExternalLink size={18} /><span><strong>Externas / clientes</strong><small>{rootCauseActions.filter((action) => action.source === "customer").length} vinculadas al portal</small></span></button>
            <button className={listScope === "internal" ? "active" : ""} type="button" onClick={() => selectListScope("internal")}><UserRound size={18} /><span><strong>Internas</strong><small>{rootCauseActions.filter((action) => action.source === "internal").length} del proceso</small></span></button>
            <button className={listScope === "system" ? "active" : ""} type="button" onClick={() => selectListScope("system")}><Building2 size={18} /><span><strong>Sistema de gestión</strong><small>{rootCauseActions.filter((action) => action.source === "audit" || action.source === "sgc").length} auditorías y SGC</small></span></button>
          </section>

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
            <label className="filter-control">
              <Filter size={15} />
              <select
                aria-label="Filtrar por estado"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">Todos</option>
                <option value="overdue">Vencidas</option>
                {statusOrder.map((status) => (
                  <option key={status} value={status}>
                    {getCorrectiveActionLabel(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="records-count">
            {filteredActions.length}{" "}
            {filteredActions.length === 1 ? "registro" : "registros"}
          </div>

          <div className="record-list">
            {filteredActions.map((action) => {
              const overdue = isCorrectiveActionOverdue(action, today);
              return (
                <button
                  key={action.id}
                  type="button"
                  className={`record-row ${
                    selected?.id === action.id ? "record-row-selected" : ""
                  }`}
                  onClick={() => {
                    setSelectedId(action.id);
                    setRegistryView("report");
                  }}
                >
                  <div className="record-row-top">
                    <span className="record-folio">{action.folio}</span>
                    <span
                      className={`status-badge ${
                        overdue ? "status-danger" : `status-${action.status}`
                      }`}
                    >
                      {overdue
                        ? "Vencida"
                        : getCorrectiveActionLabel(action.status)}
                    </span>
                  </div>
                  <strong>{action.title}</strong>
                  <div className="record-meta">
                    <span>{action.area}</span>
                    <span>{action.owner}</span>
                  </div>
                  <div className="record-progress">
                    <span style={{ width: `${action.progress}%` }} />
                  </div>
                  <div className="record-row-bottom">
                    <span>
                      <CalendarDays size={14} />
                      {formatDate(action.dueDate)}
                    </span>
                    <ChevronRight size={16} />
                  </div>
                </button>
              );
            })}
            {filteredActions.length === 0 ? <div className="access-empty"><ClipboardList size={24} /><h3>Sin acciones en este listado</h3><p>Usa otra pestaña o inicia un análisis A3.</p></div> : null}
          </div>
        </div> : null}

        {registryView === "report" && selected ? <article className="corrective-report-view">
          <A3ActionReport action={selected} onBack={() => setRegistryView("index")}>
            {canEditSelected ? <button className="button button-secondary" type="button">
              <Paperclip size={16} /> Adjuntar evidencia
            </button> : null}
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
            {isAdministrator(session) && selected.source === "customer" ? <button className="button button-secondary" type="button" disabled={publishing || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(selected.relatedPartyId ?? "")} onClick={() => void (selected.portalVisible ? unpublishSelected() : publishSelected())}>{selected.portalVisible ? "Retirar del portal" : "Autorizar publicación"}</button> : null}
            {isAdministrator(session) ? <button className="button button-secondary" type="button" onClick={() => { setDeleteCandidateId(selected.id); setDeleteReason(""); setDeleteError(""); }}><Trash2 size={16} /> Borrar</button> : null}
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
      ) : canCreate ? (
        <A3AnalysisWorkbench
          onCancel={() => setWorkspaceView("lists")}
          onComplete={completeA3Analysis}
          session={session}
        />
      ) : null}
      {deleteCandidate ? <div className="corrective-delete-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-label="Confirmar borrado de análisis"><h3>Borrar {deleteCandidate.folio}</h3><p>{deleteCandidate.title}</p><p>{deleteCandidate.problem}</p><p>Relaciones: {deleteCandidate.relatedPartyId ? "cliente vinculado; " : ""}{deleteCandidate.qualityCaseId ? "reclamación vinculada; " : ""}{deleteCandidate.a3?.plans.length ?? 0} acciones y {deleteCandidate.evidenceCount} evidencias. Se conservarán los archivos y el historial.</p><label>Motivo del borrado<input value={deleteReason} onChange={event => setDeleteReason(event.target.value)} required /></label>{deleteError ? <p role="alert">{deleteError}</p> : null}<div><button className="button button-secondary" type="button" onClick={() => setDeleteCandidateId("")}>Cancelar</button><button className="button button-primary" type="button" disabled={!deleteReason.trim() || deleting} onClick={() => void confirmDelete()}>{deleting ? "Guardando…" : "Confirmar borrado lógico"}</button></div></section></div> : null}
    </>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "neutral" | "danger" | "warning" | "success";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
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
