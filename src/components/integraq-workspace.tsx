"use client";
import { useContinuityState, useNavigationScroll } from "@/components/workspace-continuity";
import { continuityIdentity, sessionAccessKey, readContinuity, writeContinuity, confirmLeaving, hasUnsavedChanges, listenForBackgroundRefresh, traceContinuity } from "@/lib/workspace-continuity";

import {
  LoaderCircle,
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Building2,
  ChartNoAxesCombined,
  ClipboardCheck,
  Database,
  FileText,
  Gauge,
  LogOut,
  Menu,
  Network,
  PlugZap,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Target,
  UserCog,
  Users,
  Wrench,
  X,
} from "lucide-react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { verifyReviewNavigation } from "@/lib/verify-review-navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { canReturnFromReview, ReviewReturnButton } from "./modules/review-return-button";
import { managementReviewGroups, type ReviewSection, type ReviewVisit } from "@/lib/management-review-sections";
import { claimsRequest, type ClaimsCatalog, type CustomerClaim } from "@/lib/customer-claims";
import { clearHomeImages } from "@/components/modules/home-institutional-images";
import { createDocumentCatalogCache, DocumentsModule } from "@/components/modules/documents-module";

import { HomeModule } from "@/components/modules/home-module";
import { useHomeProcessData } from "@/lib/use-home-process-data";

import { ModulePlaceholder } from "@/components/modules/module-placeholder";

import { useIndicatorRuntime } from "@/hooks/use-indicator-runtime";
import { useHomeAppearance } from "@/lib/use-home-appearance";
import { withoutKnownDemoManagementReviews, withoutUnchangedSamples } from "@/lib/demo-cleanup";
import { loadStoredCorrectiveActions } from "@/lib/corrective-action-storage";
import {
  demoCorrectiveActions,
  demoMeasurementAssets,
  restoreInitialCorrectiveActions,
} from "@/lib/demo-data";
import { normalizeMeasurementAssets } from "@/lib/metrology-data";
import {
  canAccessModule,
  getDefaultModuleForSession,
  resolveAuthorizedModule,
} from "@/lib/access-policy";
import {
  buildInitialControlledDocuments,
  mergeInitialControlledDocuments,
  synchronizeAppFormDocuments,
  type ControlledDocument,
} from "@/lib/document-control-data";
import {
  loadStoredControlledDocuments,
} from "@/lib/document-storage";
import {
  appFormCatalog,
  normalizeAppForms,
  type AppFormDefinition,
} from "@/lib/form-data";
import {
  buildInitialImprovementProjects,
  normalizeImprovementProjects,
  type ImprovementProject,
} from "@/lib/continuous-improvement-data";
import { buildHomeDashboard } from "@/lib/home-dashboard";
import {
  buildInitialIndicatorDefinitions,
  buildInitialIndicatorResults,
  type ConfiguredIndicator,
  type IndicatorResults,
} from "@/lib/indicator-data";
import { applyIndicatorRuntimeAccess } from "@/lib/indicator-access";
import { DEFAULT_CAPTURE_DAYS_AFTER_CLOSE } from "@/lib/indicators/indicator-windows";
import {
  buildDemoManagementReviewHistory,
  buildManagementReviewContext,
  hasSourceChanges,
  readLocalManagementReviews,
  scopedReviewStorage,
  saveLocalManagementReview,
  type ManagementReviewRecord,
} from "@/lib/management-review-data";
import {
  isWorkspaceModuleId,
  workspaceModuleMeta,
  type WorkspaceModuleId,
} from "@/lib/navigation";
import { isDemoSession, isExternalUser, type ActiveSession } from "@/lib/session-data";
import {
  loadRiskWorkspace,
  saveRiskWorkspace,
  softDeleteStoredRisk,
  startRiskAnalysis,
} from "@/lib/risk-workspace-storage";
import {
  externalAuditCalendar,
  supplierAuditSemesters,
} from "@/lib/quality-parties-data";
import type { CorrectiveAction, MeasurementAsset } from "@/lib/types";
import {
  buildInitialRiskWorkspace,
  buildEmptyRiskWorkspace,
  normalizeRiskWorkspace,
  type RiskWorkspaceState,
} from "@/lib/risk-opportunity-data";
import {
  initialAuditOccurrences,
  type AuditOccurrence,
} from "@/lib/audit-data";

const AccessModule = dynamic(() => import("@/components/modules/access-module").then(module => module.AccessModule));
const ActivityLogModule = dynamic(() => import("@/components/modules/activity-log-module").then(module => module.ActivityLogModule));
const AuditsModule = dynamic(() => import("@/components/modules/audits-module").then(module => module.AuditsModule));
const CalibrationsModule = dynamic(() => import("@/components/modules/calibrations-module").then(module => module.CalibrationsModule));
const CorrectiveActionsModule = dynamic(() => import("@/components/modules/corrective-actions-module").then(module => module.CorrectiveActionsModule));
const ContinuousImprovementModule = dynamic(() => import("@/components/modules/continuous-improvement-module").then(module => module.ContinuousImprovementModule));
const CustomersModule = dynamic(() => import("@/components/modules/customers-module").then(module => module.CustomersModule));
const FormsModule = dynamic(() => import("@/components/modules/forms-module").then(module => module.FormsModule));
const HomeSettingsModule = dynamic(() => import("@/components/modules/home-settings-module").then(module => module.HomeSettingsModule));
const IndicatorsModule = dynamic(() => import("@/components/modules/indicators-module").then(module => module.IndicatorsModule));
const ManagementReviewModule = dynamic(() => import("@/components/modules/management-review-module").then(module => module.ManagementReviewModule));
const OrganizationModule = dynamic(() => import("@/components/modules/organization-module").then(module => module.OrganizationModule));
const ProcessesModule = dynamic(() => import("@/components/modules/processes-module").then(module => module.ProcessesModule));
const RisksOpportunitiesModule = dynamic(() => import("@/components/modules/risks-opportunities-module").then(module => module.RisksOpportunitiesModule));
const StakeholderPortalModule = dynamic(() => import("@/components/modules/stakeholder-portal-module").then(module => module.StakeholderPortalModule));
const SuppliersModule = dynamic(() => import("@/components/modules/suppliers-module").then(module => module.SuppliersModule));

const navigationGroups = [
  {
    label: "General",
    items: [{ id: "home" as const, icon: Gauge }],
  },
  {
    label: "Operación",
    items: [
      { id: "documents" as const, icon: FileText },
      { id: "risks" as const, icon: Target },
      { id: "indicators" as const, icon: ChartNoAxesCombined },
      { id: "audits" as const, icon: ShieldCheck },
      { id: "audit-app" as const, icon: Smartphone },
      { id: "corrective-actions" as const, icon: ClipboardCheck },
      { id: "customers" as const, icon: Users },
      { id: "suppliers" as const, icon: Network },
      { id: "management-review" as const, icon: Settings2 },
      { id: "continuous-improvement" as const, icon: TrendingUp },
      { id: "calibrations" as const, icon: Wrench },
    ],
  },
  {
    label: "Portales",
    items: [
      { id: "customer-portal" as const, icon: Users },
      { id: "supplier-portal" as const, icon: Network },
    ],
  },
  {
    label: "Configuración",
    items: [
      { id: "processes" as const, icon: Network },
      { id: "organization" as const, icon: Building2 },
      { id: "access" as const, icon: UserCog },
      { id: "home-settings" as const, icon: Settings2 },
      { id: "forms" as const, icon: Settings2 },
    ],
  },
  {
    label: "Plataforma",
    items: [
      { id: "ai-assistant" as const, icon: Bot },
      { id: "integrations" as const, icon: PlugZap },
      { id: "data-traceability" as const, icon: Database },
    ],
  },
] as const;

export function IntegraQWorkspace({
  onSignOut,
  session: incomingSession,
}: {
  onSignOut: () => void;
  session: ActiveSession;
}) {
  const router = useRouter();
  const navigationSequence = useRef(0);
  useEffect(() => () => { navigationSequence.current++; }, []);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNotice, setReviewNotice] = useState("");
  const editedForm = useRef<Element | null>(null);
  const serializedSession = JSON.stringify(incomingSession);
  const session = useMemo(() => JSON.parse(serializedSession) as ActiveSession, [serializedSession]);
  useEffect(() => () => clearHomeImages(session), [session]);
  const sessionKey=sessionAccessKey(session);
  const externalScope=isExternalUser(session);
  const demoMode = isDemoSession(session);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_INTEGRAQ_HOME_TIMINGS !== "1") return;
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) console.info("HOME_STARTUP", JSON.stringify({
      firstByte: Math.round(navigation.responseStart),
      htmlComplete: Math.round(navigation.responseEnd),
      domInteractive: Math.round(navigation.domInteractive),
      workspaceMounted: Math.round(performance.now()),
    }));
  }, []);
  const { appearance, error: appearanceError, refresh: refreshAppearance } = useHomeAppearance();
  const [claimSeed, setClaimSeed] = useState<CustomerClaim | null>(null);
  const [claimSeedId,setClaimSeedId]=useContinuityState("navigation:claim-seed","");
  const [claimDraftId,setClaimDraftId]=useContinuityState("navigation:claim-draft","");
  const [claimSeedError,setClaimSeedError]=useState("");
  const [claimSeedRetry,setClaimSeedRetry]=useState(0);
  const [storedActiveModule, setActiveModule] = useContinuityState<WorkspaceModuleId>("navigation:module", () =>
    getDefaultModuleForSession(session),
  );
  const activeModule=resolveAuthorizedModule(session,isWorkspaceModuleId(storedActiveModule)?storedActiveModule:null);
  const [navigationTarget, setNavigationTarget] = useContinuityState<{ module: WorkspaceModuleId; id: string } | null>("navigation:target", null);
  const [reviewVisit, setReviewVisit] = useContinuityState<ReviewVisit | null>("navigation:review", null);
  const originSection = managementReviewGroups.flatMap(group => group.sections).find(section => section.id === reviewVisit?.sectionId);
  const visit = reviewVisit && originSection?.availability === "Disponible" && originSection.module !== "management-review"
    && reviewVisit.destination === activeModule && Number.isInteger(reviewVisit.year)
    && !externalScope && canAccessModule(session, "management-review") && canAccessModule(session, originSection.module)
    ? reviewVisit : null;
  useEffect(() => {
    if (!visit && activeModule !== "management-review") return;
    let active = true;
    const stop = listenForBackgroundRefresh("management-review", async () => {
      const allowed = await verifyReviewNavigation(activeModule, sessionKey);
      if (active && !allowed) {
        navigationSequence.current++;
        setReviewVisit(null);
        setReviewBusy(false);
        router.refresh();
      }
    }, 0);
    return () => { active = false; stop(); };
  }, [activeModule, visit, sessionKey, setReviewVisit, router]);
  useNavigationScroll(activeModule);
  useEffect(()=>{
    if(!claimSeedId||activeModule!=="corrective-actions"||claimSeed?.id===claimSeedId)return;
    let active=true;
    void claimsRequest<ClaimsCatalog>().then(catalog=>{
      if (!active) return;
      const claim = catalog.claims.find(item=>item.id===claimSeedId);
      if (!claim || (claimDraftId && !claim.linkedDraftIds?.includes(claimDraftId))) {
        setClaimSeedError("El borrador o reclamo ya no está disponible en tu alcance. Vuelve a Reclamos para consultar su estado.");
        return;
      }
      if (!claimDraftId && !claim.linkedDraftIds?.length && (claim.cancelled_at || catalog.actions.some(action=>action.quality_case_id===claim.id))) {
        setClaimSeedError("El reclamo cambió. Vuelve a Reclamos para consultar el expediente relacionado.");
        return;
      }
      setClaimSeed({...claim,selectedDraftId:claimDraftId || undefined});setClaimSeedError("");
    }).catch(()=>{if(active)setClaimSeedError("No fue posible verificar el reclamo. El borrador sigue conservado; reintenta.");});
    return()=>{active=false;};
  },[claimSeedId,claimSeed?.id,activeModule,claimSeedRetry,claimDraftId]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [navigationQuery, setNavigationQuery] = useState("");
  const [actions, setActions] = useState<CorrectiveAction[]>(() => demoMode ? demoCorrectiveActions : []);
  const [assets, setAssets] = useState<MeasurementAsset[]>(demoMeasurementAssets);
  const [catalogCache] = useState(createDocumentCatalogCache);
  const [loadedDocuments, setControlledDocuments] = useState<ControlledDocument[]>(
    () => demoMode ? buildInitialControlledDocuments() : [],
  );
  const [documentLoad, setDocumentLoad] = useState<{ sessionKey: string; error: string | null } | null>(null);
  const controlledDocuments = useMemo(
    () => demoMode || (documentLoad?.sessionKey === sessionKey && !documentLoad.error) ? loadedDocuments : [],
    [demoMode, documentLoad, sessionKey, loadedDocuments],
  );
  const [forms, setForms] = useState<AppFormDefinition[]>(() =>
    normalizeAppForms(appFormCatalog.map(form => ({ ...form, records: [] }))),
  );
  const [demoIndicatorDefinitions, setDemoIndicatorDefinitions] = useState<ConfiguredIndicator[]>(
    () => demoMode ? buildInitialIndicatorDefinitions() : [],
  );
  const [demoIndicatorResults, setDemoIndicatorResults] = useState<IndicatorResults>(
    () => demoMode ? buildInitialIndicatorResults() : {},
  );
  const [demoIndicatorCaptureDays, setDemoIndicatorCaptureDays] = useState(DEFAULT_CAPTURE_DAYS_AFTER_CLOSE);
  const indicatorRuntime = useIndicatorRuntime(
    !demoMode && ["indicators", "risks"].includes(activeModule) && !isExternalUser(session) && canAccessModule(session, "indicators"),
  );
  const indicatorDefinitions = demoMode ? demoIndicatorDefinitions : indicatorRuntime.definitions;
  const indicatorResults = demoMode ? demoIndicatorResults : indicatorRuntime.results;
  const indicatorSession = useMemo(
    () => demoMode || !indicatorRuntime.access ? session : applyIndicatorRuntimeAccess(session, indicatorRuntime.access),
    [demoMode, indicatorRuntime.access, session],
  );
  const [riskWorkspace, setRiskWorkspace] = useState<RiskWorkspaceState>(
    buildEmptyRiskWorkspace,
  );
  const [managementReviews, setManagementReviews] = useState<ManagementReviewRecord[]>(
    () => [],
  );
  const [improvementProjects, setImprovementProjects] = useState<ImprovementProject[]>(
    () => [],
  );
  const [auditOccurrences, setAuditOccurrences] = useState<AuditOccurrence[]>(
    () => demoMode ? initialAuditOccurrences : [],
  );
  const [storageReady, setStorageReady] = useState(false);
  const [actionLoadError, setActionLoadError] = useState("");
  const [actionLoadedSession, setActionLoadedSession] = useState<string | null>(null);
  const [actionRetry, setActionRetry] = useState(0);
  const [riskServerReady, setRiskServerReady] = useState(false);
  const [riskLoadError, setRiskLoadError] = useState("");
  const [riskRetry, setRiskRetry] = useState(0);
  const loadedRiskSnapshot = useRef<string | null>(null);

  useEffect(() => {
    const syncModuleFromHash = () => {
      const hash = window.location.hash.slice(1);
      const saved = readContinuity<string>(continuityIdentity(session),sessionAccessKey(session),"navigation:module");
      const requestedModule = isWorkspaceModuleId(hash) ? hash : typeof saved === "string" && isWorkspaceModuleId(saved) ? saved : null;
      const authorizedModule = resolveAuthorizedModule(
        session,
        requestedModule,
      );
      const savedVisit = readContinuity<ReviewVisit>(continuityIdentity(session),sessionAccessKey(session),"navigation:review");
      if (savedVisit && savedVisit.destination !== authorizedModule) setReviewVisit(null);
      setActiveModule(authorizedModule);
      if (hash !== authorizedModule) {
        window.history.replaceState(null, "", `#${authorizedModule}`);
      }
    };

    syncModuleFromHash();
    const onHashChange=()=>{if(!confirmLeaving()){const saved=readContinuity<string>(continuityIdentity(session),sessionAccessKey(session),"navigation:module");window.history.replaceState(null,"",`#${saved??getDefaultModuleForSession(session)}`);return;}syncModuleFromHash();};
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [session,setActiveModule,setReviewVisit]);

  useEffect(() => {
    const hydrationTask = window.setTimeout(() => {
      try {
        const savedActions = demoMode ? window.localStorage.getItem("integraq.correctiveActions") : null;
        const savedAssets = window.localStorage.getItem("integraq.measurementAssets.v2");
        const savedDocuments = demoMode ? window.localStorage.getItem("integraq.controlledDocuments.v1") : null;
        const savedForms = window.localStorage.getItem("integraq.appForms.v1");
        const savedRiskWorkspace = window.localStorage.getItem("integraq.riskWorkspace.v1");
        const savedImprovementProjects = window.localStorage.getItem("integraq.improvementProjects.v2") ?? window.localStorage.getItem("integraq.improvementProjects.v1");
        const savedAudits = window.localStorage.getItem("integraq.auditOccurrences.v1");
        if (savedActions) {
          setActions(restoreInitialCorrectiveActions(JSON.parse(savedActions) as CorrectiveAction[]));
        }
        if (savedAssets) setAssets(normalizeMeasurementAssets(JSON.parse(savedAssets) as MeasurementAsset[], demoMeasurementAssets));
        const hydratedForms = normalizeAppForms((savedForms
          ? JSON.parse(savedForms) as AppFormDefinition[]
          : appFormCatalog).map(form => ({ ...form,
          records: withoutUnchangedSamples(form.records, appFormCatalog.find(sample => sample.id === form.id)?.records ?? []),
        })));
        setForms(hydratedForms);
        if (demoMode) {
          const hydratedDocuments = savedDocuments
            ? mergeInitialControlledDocuments(JSON.parse(savedDocuments) as ControlledDocument[])
            : buildInitialControlledDocuments();
          setControlledDocuments(synchronizeAppFormDocuments(hydratedDocuments, hydratedForms));
        }
        if (savedRiskWorkspace) {
          const saved = JSON.parse(savedRiskWorkspace) as RiskWorkspaceState;
          const samples = buildInitialRiskWorkspace();
          setRiskWorkspace(normalizeRiskWorkspace({ ...saved,
            risks: withoutUnchangedSamples(saved.risks ?? [], samples.risks),
            swotItems: withoutUnchangedSamples(saved.swotItems ?? [], samples.swotItems),
            actions: withoutUnchangedSamples(saved.actions ?? [], samples.actions),
            contributions: withoutUnchangedSamples(saved.contributions ?? [], samples.contributions),
            importIssues: withoutUnchangedSamples(saved.importIssues ?? [], samples.importIssues),
          }));
        }
        if (savedImprovementProjects) {
          const samples = buildInitialImprovementProjects();
          setImprovementProjects(normalizeImprovementProjects(withoutUnchangedSamples(JSON.parse(savedImprovementProjects) as ImprovementProject[], [...samples, ...normalizeImprovementProjects(samples)], ["createdAt", "updatedAt"])));
        }
        if (savedAudits) {
          const saved = JSON.parse(savedAudits) as AuditOccurrence[];
          setAuditOccurrences(demoMode ? saved : withoutUnchangedSamples(saved, initialAuditOccurrences));
        }
      } catch {
        // Keep the empty state when browser storage is unavailable.
      } finally {
        setStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(hydrationTask);
  }, [demoMode]);

  useEffect(() => {
    if (storageReady && demoMode) {
      window.localStorage.setItem("integraq.correctiveActions", JSON.stringify(actions));
    }
  }, [actions, storageReady, demoMode]);

  const needsActions = ["corrective-actions", "customers", "customer-portal", "supplier-portal"].includes(activeModule);
  useEffect(() => {
    if (!storageReady || demoMode || externalScope || !needsActions) return;
    let active = true;
    void loadStoredCorrectiveActions()
      .then(stored => {
        if (!active) return;
        setActions(stored);
        setActionLoadedSession(sessionKey);
        setActionLoadError("");
      })
      .catch(cause => { if (active) { setActionLoadedSession(null); setActionLoadError(cause instanceof Error ? cause.message : "No fue posible consultar Root2Cause."); } });
    return () => { active = false; };
  }, [storageReady, demoMode, sessionKey, externalScope, actionRetry, needsActions]);

  useEffect(() => {
    if (storageReady) {
      window.localStorage.setItem("integraq.measurementAssets.v2", JSON.stringify(assets));
    }
  }, [assets, storageReady]);

  useEffect(() => {
    if (!storageReady || !demoMode) return;
    window.localStorage.setItem("integraq.controlledDocuments.v1", JSON.stringify(loadedDocuments));
  }, [loadedDocuments, storageReady, demoMode]);

  const needsGlobalDocuments = activeModule === "home-settings";
  useEffect(() => {
    if (!storageReady || demoMode || !needsGlobalDocuments || externalScope) return;
    const controller = new AbortController();
    void loadStoredControlledDocuments({ signal: controller.signal }).then(documents => {
      if (!controller.signal.aborted) {
        setControlledDocuments(documents);
        setDocumentLoad({ sessionKey, error: null });
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDocumentLoad({ sessionKey, error: error instanceof Error ? error.message : "Error en la consulta documental." });
    });
    return () => controller.abort();
  }, [storageReady, demoMode, sessionKey, needsGlobalDocuments, externalScope]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.appForms.v1", JSON.stringify(forms));
  }, [forms, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.riskWorkspace.v1", JSON.stringify(riskWorkspace));
  }, [riskWorkspace, storageReady]);

  useEffect(() => {
    if (!storageReady || externalScope || (!demoMode && activeModule !== "risks")) return;
    let active = true;
    void loadRiskWorkspace()
      .then(({ state }) => {
        if (!active) return;
        const normalized = normalizeRiskWorkspace(state);
        loadedRiskSnapshot.current = JSON.stringify(normalized);
        setRiskWorkspace(normalized);
        setRiskServerReady(true);
        setRiskLoadError("");
      })
      .catch((cause: unknown) => {
        if (active) { setRiskServerReady(false); setRiskLoadError(cause instanceof Error ? cause.message : "No se pudo consultar la matriz de riesgos."); }
      });
    return () => { active = false; };
  }, [sessionKey, externalScope, storageReady, riskRetry, activeModule, demoMode]);

  useEffect(() => {
    if (!riskServerReady || externalScope) return;
    const snapshot = JSON.stringify(riskWorkspace);
    if (snapshot === loadedRiskSnapshot.current) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void saveRiskWorkspace(riskWorkspace)
        .then(() => { if (active) loadedRiskSnapshot.current = snapshot; })
        .catch((cause: unknown) => {
          if (!active) return;
          setRiskServerReady(false);
          setRiskLoadError(cause instanceof Error ? cause.message : "No se pudo guardar la matriz de riesgos.");
        });
    }, 700);
    return () => { active = false; window.clearTimeout(timer); };
  }, [riskServerReady, riskWorkspace, externalScope]);

  const [reviewsIdentity,setReviewsIdentity]=useState("");
  const [legacyPending,setLegacyPending]=useState(false);
  const [reviewsReady, setReviewsReady] = useState(false);
  const [reviewsError, setReviewsError] = useState(false);
  const [reviewRetry, setReviewRetry] = useState(0);
  useEffect(() => {
    if (externalScope || !canAccessModule(session, "management-review")) return;
    const readLocalReviews = () => {
      try {
        const storage=demoMode?window.localStorage:scopedReviewStorage(window.localStorage,session);
        const stored = readLocalManagementReviews(storage);
        if (!demoMode && session.userType === "Administrador") {
          try {
            const unscoped = readLocalManagementReviews(window.localStorage);
            setLegacyPending(withoutKnownDemoManagementReviews(unscoped).some(report => report.draft?.mode !== "demo"));
          } catch {
            setLegacyPending(true);
          }
        } else {
          setLegacyPending(false);
        }
        setReviewsIdentity(sessionKey);
        const saved = withoutUnchangedSamples(stored, buildDemoManagementReviewHistory());
        setManagementReviews(demoMode ? saved : withoutKnownDemoManagementReviews(saved).filter(report => report.draft?.mode !== "demo"));
        setReviewsError(false);
      } catch {
        setReviewsError(true);
      } finally {
        setReviewsReady(true);
      }
    };
    const timer = window.setTimeout(readLocalReviews, 0);
    return () => window.clearTimeout(timer);
  }, [session, sessionKey, externalScope, demoMode, reviewRetry]);

  function saveManagementReview(previous: ManagementReviewRecord, next: ManagementReviewRecord) {
    saveLocalManagementReview(demoMode?window.localStorage:scopedReviewStorage(window.localStorage,session), previous, next);
    setManagementReviews(records => records.map(record => record.id === previous.id ? next : record));
  }

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.improvementProjects.v2", JSON.stringify(improvementProjects));
  }, [improvementProjects, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem("integraq.auditOccurrences.v1", JSON.stringify(auditOccurrences));
  }, [auditOccurrences, storageReady]);

  const currentManagementReview = useMemo(
    () =>
      reviewsIdentity!==sessionKey ? null : managementReviews.find((record) => record.period.year === new Date().getFullYear()) ??
      managementReviews[0] ??
      null,
    [managementReviews,reviewsIdentity,sessionKey],
  );

  function reviewSourcesChanged(record: ManagementReviewRecord) {
    if (record.period.year !== new Date().getFullYear()) return false;
    // Compare only sources already available in the authorized workspace.
    if (!demoMode && (documentLoad?.sessionKey !== sessionKey || documentLoad.error ||
        actionLoadedSession !== sessionKey || !indicatorRuntime.access || indicatorRuntime.error)) return false;
    if (!["documents", "indicators", "corrective-actions", "calibrations"].every(
      module => isWorkspaceModuleId(module) && canAccessModule(session, module))) return false;
    const context = buildManagementReviewContext({
      session, documents: controlledDocuments, actions, assets: withoutUnchangedSamples(assets, demoMeasurementAssets),
      indicators: indicatorDefinitions, indicatorResults, supplierAudits: [], externalAudits: [], customers: [],
      suppliers: [], certifications: [], rncpSummary: { total: 0, closed: 0, late: 0, inProcess: 0 },
    }, record.period);
    return hasSourceChanges(record, context);
  }

  const activeMeta = workspaceModuleMeta[activeModule];
  const homeSources = useMemo(
    () => ({
      session,
      documents: controlledDocuments,
      documentLoadError: !demoMode && documentLoad?.sessionKey === sessionKey ? documentLoad.error : undefined,
      documentsLoading: !demoMode && documentLoad?.sessionKey !== sessionKey,
      actions,
      assets,
      indicators: indicatorDefinitions,
      indicatorResults,
      supplierAudits: supplierAuditSemesters.flatMap((semester) => semester.events),
      externalAudits: externalAuditCalendar,
      managementReview: currentManagementReview,
      risks: riskWorkspace,
    }),
    [demoMode, documentLoad, sessionKey, actions, assets, controlledDocuments, currentManagementReview, indicatorDefinitions, indicatorResults, riskWorkspace, session],
  );
  const localHomeDashboard = useMemo(
    () => demoMode ? buildHomeDashboard(homeSources) : null,
    [demoMode, homeSources],
  );
  const productionHome = useHomeProcessData(session, undefined, activeModule === "home" || notificationsOpen);
  const homeDashboard = localHomeDashboard ?? productionHome.dashboard;

  const changeModule = async (module: WorkspaceModuleId, targetId?: string, origin?: ReviewSection | "menu", year?: number, beforeOpen?: () => void) => {
    if (visit && !hasUnsavedChanges() && editedForm.current?.isConnected
      && !window.confirm("Hay cambios sin guardar. ¿Deseas salir de esta vista?")) return;
    if (!confirmLeaving()) return;
    const sequence = ++navigationSequence.current;
    const hash = window.location.hash;
    setReviewNotice("");
    if (origin !== "menu" && (visit || origin)) {
      setReviewBusy(true);
      try {
        const allowed = await verifyReviewNavigation(module, sessionKey);
        if (sequence !== navigationSequence.current || window.location.hash !== hash) return;
        if (!allowed) {
          setReviewVisit(null);
          setReviewNotice("El acceso cambió. Actualiza la sesión para continuar.");
          router.refresh();
          return;
        }
      } catch {
        if (sequence === navigationSequence.current) setReviewNotice("No se pudo verificar el acceso. Vuelve a intentar.");
        return;
      } finally {
        if (sequence === navigationSequence.current) setReviewBusy(false);
      }
    } else setReviewBusy(false);
    editedForm.current = null;
    beforeOpen?.();
    writeContinuity(continuityIdentity(session),sessionKey,`scroll:${activeModule}`,Math.max(0,window.scrollY));
    traceContinuity("module-navigation",module);
    const authorizedModule = resolveAuthorizedModule(session, module);
    if (origin && origin !== "menu") {
      if (activeModule !== "management-review" || externalScope || !canAccessModule(session, "management-review")
        || authorizedModule !== origin.module || module !== origin.module || origin.availability !== "Disponible" || !year) return;
      setReviewVisit({ sectionId: origin.id, destination: module, year });
      if (origin.id === "customers") writeContinuity(continuityIdentity(session), sessionKey, "review:customers-tab", "cases");
    } else if (origin === "menu" || module === "management-review" || authorizedModule !== module || !visit) {
      setReviewVisit(null);
    } else {
      setReviewVisit({ ...visit, destination: module });
    }
    if (authorizedModule !== "corrective-actions") {setClaimSeed(null);setClaimSeedId("");}
    setActiveModule(authorizedModule);
    setNavigationTarget(
      authorizedModule === module && targetId ? { module, id: targetId } : null,
    );
    setSidebarOpen(false);
    setNotificationsOpen(false);
    setNavigationQuery("");
    window.scrollTo({ top: 0, behavior: "auto" });
    if (window.location.hash.slice(1) !== authorizedModule) {
      window.history.pushState(null, "", `#${authorizedModule}`);
    }
  };

  const changeForms = (nextForms: AppFormDefinition[]) => {
    setForms(nextForms);
    if (demoMode) setControlledDocuments((documents) =>
      synchronizeAppFormDocuments(documents, nextForms),
    );
  };

  const normalizedNavigationQuery = navigationQuery.trim().toLocaleLowerCase("es");
  const externalSession = isExternalUser(session);

  return (
    <div className="app-frame" data-text-size={appearance.textSize} style={{ "--app-text-scale": appearance.textSize / 100, "--home-text-scale": appearance.textSize / 100 } as CSSProperties}>
      {appearanceError ? <div className="app-appearance-error" role="alert">No se pudo consultar el tamaño de texto. <button type="button" onClick={refreshAppearance}>Reintentar</button></div> : null}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Image src="/brand/integraq-logo.png" alt="" width={38} height={38} priority />
          </div>
          <div>
            <div className="brand-name">IntegraQ</div>
            <div className="brand-subtitle">Gestión de calidad</div>
          </div>
          <button className="icon-button sidebar-close" type="button" title="Cerrar navegación" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="brand-flow-bar" aria-hidden="true" />

        <div className="sidebar-search">
          <Search size={15} />
          <input value={navigationQuery} onChange={(event) => setNavigationQuery(event.target.value)} placeholder="Buscar módulo" aria-label="Buscar módulo" />
        </div>

        <nav className="sidebar-nav" aria-label="Módulos principales">
          {navigationGroups.map((group) => {
            const visibleItems = group.items.filter(
              (item) =>
                canAccessModule(session, item.id) &&
                workspaceModuleMeta[item.id].label
                  .toLocaleLowerCase("es")
                  .includes(normalizedNavigationQuery),
            );
            if (visibleItems.length === 0) return null;
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-section-label">{group.label}</div>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const meta = workspaceModuleMeta[item.id];
                  const isActive = item.id === activeModule;
                  return (
                    <button key={item.id} type="button" className={`nav-item ${isActive ? "nav-item-active" : ""}`} onClick={() => changeModule(item.id, undefined, "menu")}>
                      <Icon size={17} strokeWidth={1.8} />
                      <span>{meta.label}</span>
                      {meta.status !== "Disponible" ? <span className={`nav-status nav-status-${meta.status.toLocaleLowerCase("es")}`} title={meta.status} /> : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="user-summary" onClick={onSignOut} title="Cerrar sesión" type="button">
            <div className="avatar">{session.initials}</div>
            <div className="user-copy"><strong>{session.shortName}</strong><span>{session.position}</span></div>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {sidebarOpen ? <button className="sidebar-scrim" type="button" aria-label="Cerrar navegación" onClick={() => setSidebarOpen(false)} /> : null}

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button mobile-menu" type="button" title="Abrir navegación" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            <Image className="topbar-company-logo" src="/brand/towell-logo.jpg" alt="Towell" width={154} height={44} priority />
          </div>
          <h1 className="topbar-page-title">{activeMeta.label}</h1>
          <div className="topbar-actions">
            {!externalSession ? <button className="icon-button" type="button" title="Actividad" onClick={() => changeModule("home", undefined, "menu")}><Activity size={19} /></button> : null}
            {!externalSession ? <div className="notification-wrap">
              <button className="icon-button notification-button" type="button" title="Notificaciones" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>
                <Bell size={19} />{homeDashboard.alerts.length ? <span aria-label={`${homeDashboard.alerts.length} notificaciones`}>{homeDashboard.alerts.length}</span> : null}
              </button>
              {notificationsOpen ? (
                <div className="notification-popover">
                  <div className="popover-heading"><strong>Notificaciones</strong><small>{homeDashboard.alerts.length} pendientes</small></div>
                  {homeDashboard.alerts.slice(0, 5).map((alert) => (
                    <button key={alert.id} type="button" onClick={() => changeModule(alert.module, alert.targetId, "menu")}><AlertTriangle size={16} /><span><strong>{alert.title}</strong><small>{alert.alertType} · {alert.moduleLabel}</small></span></button>
                  ))}
                  {homeDashboard.alerts.length === 0 ? <div className="notification-empty">Sin alertas pendientes</div> : null}
                </div>
              ) : null}
            </div> : null}
          </div>
        </header>

        <main key={visit?.sectionId ?? "workspace"} onChangeCapture={event => {
          if (visit && event.target instanceof HTMLElement) {
            const form = event.target.closest("form, [role='dialog']");
            if (form) editedForm.current = form;
          }
        }} className={`workspace ${activeModule === "home" ? "workspace-home" : ""}`}>
          {reviewBusy && <progress aria-label="Abriendo apartado" />}
          {reviewNotice && <p role="alert">{reviewNotice}</p>}
          {canReturnFromReview(session, Boolean(visit), activeModule) && <ReviewReturnButton onReturn={() => changeModule("management-review")} />}
          {activeModule === "home" ? <HomeModule baseRetry={productionHome.retry} baseFailed={productionHome.failed} baseDashboard={productionHome.dashboard} loading={demoMode && !storageReady} onNavigate={changeModule} sources={homeSources} /> : null}
          {activeModule === "processes" ? <ProcessesModule /> : null}
          {activeModule === "organization" ? <OrganizationModule session={session} /> : null}
          {activeModule === "access" ? <AccessModule /> : null}
          {activeModule === "home-settings" ? <HomeSettingsModule onChangeDocument={(updated) => {
            clearHomeImages(session);
            catalogCache.index.clear();
            catalogCache.lists.clear();
            catalogCache.current.clear();
            setControlledDocuments(current => current.map(document => document.id === updated.id ? updated : document));
          }} documents={controlledDocuments} session={session} onManageDocument={(id) => changeModule("documents", id)} /> : null}
          {activeModule === "data-traceability" ? <ActivityLogModule /> : null}
          {activeModule === "documents" ? <DocumentsModule reviewDocument={visit?.sectionId === "policy" || visit?.sectionId === "manual" ? visit.sectionId : undefined} cache={catalogCache} liveCatalog={!demoMode} controlledDocuments={controlledDocuments} focusId={navigationTarget?.module === "documents" ? navigationTarget.id : undefined} forms={forms} key={sessionKey + (navigationTarget?.module === "documents" ? navigationTarget.id : "index")} onControlledDocumentsChange={setControlledDocuments} session={session} /> : null}
          {activeModule === "forms" ? <FormsModule forms={forms} onFormsChange={changeForms} session={session} /> : null}
          {activeModule === "indicators" ? <IndicatorsModule initialYear={visit?.year} captureDaysAfterClose={demoMode ? demoIndicatorCaptureDays : indicatorRuntime.settings.captureDaysAfterClose} definitions={indicatorDefinitions} error={demoMode ? "" : indicatorRuntime.error} focusId={navigationTarget?.module === "indicators" ? navigationTarget.id : undefined} key={`indicators-${navigationTarget?.module === "indicators" ? navigationTarget.id : "index"}`} loading={!demoMode && indicatorRuntime.loading} onDefinitionDelete={demoMode ? async (indicatorId) => { setDemoIndicatorDefinitions((definitions) => definitions.filter((indicator) => indicator.id !== indicatorId)); setDemoIndicatorResults((results) => { const next = { ...results }; delete next[indicatorId]; return next; }); } : indicatorRuntime.disableDefinition} onDefinitionSave={demoMode ? async (indicator) => { setDemoIndicatorDefinitions((definitions) => definitions.some((item) => item.id === indicator.id) ? definitions.map((item) => item.id === indicator.id ? indicator : item) : [...definitions, indicator]); } : indicatorRuntime.saveDefinition} onRefresh={demoMode ? async () => undefined : indicatorRuntime.refresh} onResultSave={demoMode ? async (input) => { setDemoIndicatorResults((results) => ({ ...results, [input.indicatorId]: { ...(results[input.indicatorId] ?? {}), [String(input.year)]: { ...(results[input.indicatorId]?.[String(input.year)] ?? {}), [input.quarter]: { value: input.value, comments: input.comments, evidenceFileId: input.evidenceFileId, adminOverrideReason: input.adminOverrideReason, submittedAt: new Date().toISOString(), submittedBy: session.name } } } })); } : indicatorRuntime.saveResult} onSettingsSave={demoMode ? async (days) => setDemoIndicatorCaptureDays(days) : async (days) => indicatorRuntime.saveSettings({ captureDaysAfterClose: days, timezone: "America/Mexico_City" })} results={indicatorResults} saving={!demoMode && indicatorRuntime.saving} session={indicatorSession} /> : null}
          {activeModule === "risks" && !demoMode && !riskServerReady ? <section role={riskLoadError ? "alert" : "status"}><p>{(visit && riskLoadError ? "No fue posible consultar la matriz de riesgos." : riskLoadError) || <LoaderCircle className="spin" size={16} aria-label="Cargando riesgos" />}</p>{riskLoadError ? <button type="button" onClick={() => { setRiskLoadError(""); setRiskRetry(value => value + 1); }}>Reintentar</button> : null}</section> : null}
          {activeModule === "risks" && (demoMode || riskServerReady) ? <RisksOpportunitiesModule initialTab={visit?.sectionId === "risks" ? "swot" : undefined} indicatorResults={indicatorResults} indicators={indicatorDefinitions} onActivate={async () => { const result = await startRiskAnalysis(); setRiskWorkspace(result.state); setRiskServerReady(true); return result; }} onChange={setRiskWorkspace} onDeleteRisk={async (id, reason, kind) => { const result = await softDeleteStoredRisk(id, reason, kind); const normalized = normalizeRiskWorkspace(result.state); loadedRiskSnapshot.current = JSON.stringify(normalized); setRiskWorkspace(normalized); return result.auditLogged; }} onNavigateToIndicators={(indicatorId) => changeModule("indicators", indicatorId)} serverConnected={riskServerReady} session={session} state={riskWorkspace} /> : null}
          {activeModule === "audits" ? <AuditsModule initialYear={visit?.year} occurrences={auditOccurrences} onOccurrencesChange={setAuditOccurrences} session={session} /> : null}
          {activeModule === "corrective-actions" && claimSeedId && claimSeed?.id!==claimSeedId ? <section role={claimSeedError?"alert":"status"}><p>{claimSeedError||"Verificando el reclamo vinculado al borrador…"}</p>{claimSeedError?<><button type="button" onClick={()=>setClaimSeedRetry(value=>value+1)}>Reintentar</button><button type="button" onClick={()=>changeModule("customers")}>Volver a Clientes</button></>:null}</section>:null}
          {activeModule === "corrective-actions" && !demoMode && actionLoadedSession !== sessionKey ? <section role={actionLoadError ? "alert" : "status"}><p>{actionLoadError || <LoaderCircle className="spin" size={16} aria-label="Cargando acciones correctivas" />}</p>{actionLoadError ? <button type="button" onClick={() => { setActionLoadError(""); setActionRetry(value => value + 1); }}>Reintentar</button> : null}</section> : null}
          {activeModule === "corrective-actions" && (!claimSeedId||claimSeed?.id===claimSeedId) && (demoMode || actionLoadedSession === sessionKey) ? <CorrectiveActionsModule actions={actions} claimSeed={claimSeed??undefined} onClaimSeedClear={()=>{setClaimSeed(null);setClaimSeedId("");}} onNavigateCustomers={()=>changeModule("customers")} focusId={navigationTarget?.module === "corrective-actions" ? navigationTarget.id : undefined} key={`corrective-${claimSeed?.id??(navigationTarget?.module === "corrective-actions" ? navigationTarget.id : "index")}`} onActionsChange={setActions} session={session} /> : null}
          {activeModule === "calibrations" ? <CalibrationsModule assets={assets} focusId={navigationTarget?.module === "calibrations" ? navigationTarget.id : undefined} key={`calibrations-${navigationTarget?.module === "calibrations" ? navigationTarget.id : "index"}`} onAssetsChange={setAssets} session={session} /> : null}
          {activeModule === "customers" ? <CustomersModule fromReview={!!visit} onOpenDocuments={id => changeModule("customer-portal",id)} key={`customers-${session.authUserId??session.userId}`} actions={actions} demoMode={demoMode} session={session} onCreateA3={claim=>void changeModule("corrective-actions", undefined, undefined, undefined, () => {writeContinuity(continuityIdentity(session),sessionKey,"root2cause:view","a3");setClaimDraftId(claim.selectedDraftId ?? "");setClaimSeedId(claim.id);setClaimSeed(claim);})} onOpenA3={id=>void changeModule("corrective-actions", id, undefined, undefined, () => {for(const [key,value] of Object.entries({view:"lists",selected:id,scope:"customer",registry:"report",query:"",status:"all"}))writeContinuity(continuityIdentity(session),sessionKey,`root2cause:${key}`,value);setClaimSeedId("");setClaimSeed(null);})} /> : null}
          {activeModule === "suppliers" ? <SuppliersModule initialYear={visit?.year} session={session} /> : null}
          {activeModule === "management-review" ? <ManagementReviewModule onOpenSection={(section, year) => changeModule(section.module, undefined, section, year)} key={sessionKey} sourcesChanged={reviewSourcesChanged} onRecordChange={saveManagementReview} records={reviewsIdentity===sessionKey?managementReviews:[]} session={session} legacyPending={legacyPending && reviewsIdentity===sessionKey} recordsReady={reviewsReady && reviewsIdentity===sessionKey} recordsError={reviewsError} onRetryRecords={() => setReviewRetry(value => value + 1)} /> : null}
          {activeModule === "continuous-improvement" ? <ContinuousImprovementModule projects={improvementProjects} onProjectsChange={setImprovementProjects} session={session} /> : null}
          {activeModule === "customer-portal" ? <StakeholderPortalModule initialCustomerId={navigationTarget?.module === "customer-portal" ? navigationTarget.id : undefined} kind="customer" actions={actions} session={session} /> : null}
          {activeModule === "supplier-portal" ? <StakeholderPortalModule kind="supplier" actions={actions} session={session} /> : null}
          {!["home", "home-settings", "processes", "organization", "access", "documents", "forms", "risks", "indicators", "audits", "corrective-actions", "calibrations", "customers", "suppliers", "management-review", "continuous-improvement", "customer-portal", "supplier-portal", "data-traceability"].includes(activeModule) ? <ModulePlaceholder module={activeMeta} /> : null}
        </main>
      </div>

    </div>
  );
}
