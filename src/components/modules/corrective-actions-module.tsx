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
  getCorrectiveActionLabel,
  isCorrectiveActionOverdue,
  toIsoDate,
} from "@/lib/domain";
import type {
  AiRootCauseDraft,
  CorrectiveAction,
  CorrectiveActionStatus,
} from "@/lib/types";

interface CorrectiveActionsModuleProps {
  actions: CorrectiveAction[];
  focusId?: string;
  onActionsChange: (actions: CorrectiveAction[]) => void;
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
      : focusedAction?.source === "audit"
        ? "system"
        : focusedAction
          ? "internal"
          : "open",
  );
  const [registryView, setRegistryView] = useState<CorrectiveRegistryView>("index");
  const [isAiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const rootCauseActions = useMemo(
    () => actions.filter((action) => action.source !== "supplier"),
    [actions],
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
        (listScope === "system" && action.source === "audit");
      return matchesQuery && matchesStatus && matchesScope;
    });
  }, [listScope, query, rootCauseActions, statusFilter, today]);

  const selected =
    filteredActions.find((action) => action.id === selectedId) ??
    filteredActions[0] ??
    rootCauseActions[0];

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
    onActionsChange(
      actions.map((action) =>
        action.id === selected.id ? { ...action, ...changes } : action,
      ),
    );
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

  const completeA3Analysis = (values: A3Submission) => {
    const nextNumber =
      Math.max(
        0,
        ...actions.map((action) => Number(action.folio.split("-").at(-1)) || 0),
      ) + 1;
    const action: CorrectiveAction = {
      ...values,
      id: crypto.randomUUID(),
      folio: `AC-2026-${String(nextNumber).padStart(3, "0")}`,
      createdAt: today,
      status: "action_plan",
      progress: 55,
      evidenceCount: 0,
      rootCause: values.a3.rootCause,
    };

    onActionsChange([action, ...actions]);
    setSelectedId(action.id);
    setListScope(
      action.source === "customer"
        ? "customer"
        : action.source === "audit"
          ? "system"
          : "internal",
    );
    setWorkspaceView("lists");
    setRegistryView("report");
  };

  const selectListScope = (scope: CorrectiveListScope) => {
    setListScope(scope);
    setRegistryView("index");
  };

  if (!selected) {
    return null;
  }

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">CAPA / Root2Cause</p>
          <h2>Root2Cause y acciones correctivas</h2>
          <p>
            Listados por origen y análisis A3 desde la detección hasta la eficacia.
          </p>
        </div>
        <button className="button button-primary" onClick={() => setWorkspaceView("a3")}>
          <Plus size={17} />
          Iniciar análisis A3
        </button>
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
        <button className={workspaceView === "a3" ? "active" : ""} type="button" onClick={() => setWorkspaceView("a3")}><ClipboardList size={15} /> Análisis A3</button>
      </div>

      {workspaceView === "lists" ? (
        <>
          <section className="corrective-list-menu" aria-label="Listados por origen">
            <button className={listScope === "open" ? "active" : ""} type="button" onClick={() => selectListScope("open")}><ClipboardList size={18} /><span><strong>Acciones abiertas</strong><small>{rootCauseActions.filter((action) => action.status !== "closed").length} registros activos</small></span></button>
            <button className={listScope === "customer" ? "active" : ""} type="button" onClick={() => selectListScope("customer")}><ExternalLink size={18} /><span><strong>Externas / clientes</strong><small>{rootCauseActions.filter((action) => action.source === "customer").length} vinculadas al portal</small></span></button>
            <button className={listScope === "internal" ? "active" : ""} type="button" onClick={() => selectListScope("internal")}><UserRound size={18} /><span><strong>Internas</strong><small>{rootCauseActions.filter((action) => action.source === "internal").length} del proceso</small></span></button>
            <button className={listScope === "system" ? "active" : ""} type="button" onClick={() => selectListScope("system")}><Building2 size={18} /><span><strong>Sistema de gestión</strong><small>{rootCauseActions.filter((action) => action.source === "audit").length} auditorías y SGC</small></span></button>
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
                    selected.id === action.id ? "record-row-selected" : ""
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
          </div>
        </div> : null}

        {registryView === "report" ? <article className="corrective-report-view">
          <A3ActionReport action={selected} onBack={() => setRegistryView("index")}>
            <button className="button button-secondary" type="button">
              <Paperclip size={16} /> Adjuntar evidencia
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                const currentIndex = statusOrder.indexOf(selected.status);
                const nextStatus = statusOrder[Math.min(currentIndex + 1, statusOrder.length - 1)];
                updateSelected({ status: nextStatus, progress: Math.min(100, selected.progress + 18) });
              }}
              disabled={selected.status === "closed"}
            >
              <CheckCircle2 size={16} /> Avanzar etapa
            </button>
          </A3ActionReport>
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
                disabled={isAiLoading}
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
                onUseRootCause={(rootCause) => updateSelected({ rootCause })}
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
      ) : (
        <A3AnalysisWorkbench
          onCancel={() => setWorkspaceView("lists")}
          onComplete={completeA3Analysis}
        />
      )}
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
