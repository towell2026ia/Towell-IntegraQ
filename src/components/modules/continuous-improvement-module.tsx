"use client";

import {
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileCheck2,
  FolderKanban,
  Gauge,
  ImageIcon,
  Lightbulb,
  ListChecks,
  Plus,
  Route,
  Search,
  Target,
  Upload,
  Users,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import {
  calculateProjectCompliance,
  calculateProjectRpmScore,
  calculateProjectScore,
  createImprovementProject,
  getImprovementProjectsForSession,
  getProjectProgress,
  improvementProjectCategoryLabels,
  improvementProjectTypeDescriptions,
  improvementProjectTypeLabels,
  maximumRpmScore,
  type ImprovementAction,
  type ImprovementProject,
  type ImprovementProjectCategory,
  type ImprovementProjectStatus,
  type ImprovementProjectType,
  type RapidImprovementKind,
} from "@/lib/continuous-improvement-data";
import { processCatalog } from "@/lib/configuration-data";
import type { ActiveSession } from "@/lib/session-data";

type MainView = "register" | "portfolio";
type IntakeMode = "idea" | "project";
type DetailView = "charter" | "route" | "plan" | "scorecard";

interface ContinuousImprovementModuleProps {
  projects: ImprovementProject[];
  onProjectsChange: (projects: ImprovementProject[]) => void;
  session: ActiveSession;
}

const currency = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

const projectStatuses: ImprovementProjectStatus[] = [
  "Abierto",
  "Kick off",
  "En proceso",
  "Tarde",
  "Terminado",
];

export function ContinuousImprovementModule({ projects, onProjectsChange, session }: ContinuousImprovementModuleProps) {
  const [activeView, setActiveView] = useState<MainView>("portfolio");
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const manager = session.userType === "Administrador" || session.continuousImprovementRole === "manager";
  const scopedProjects = getImprovementProjectsForSession(projects, session);
  const activeProjects = scopedProjects.filter((project) => ["Kick off", "En proceso", "Tarde"].includes(project.status)).length;
  const closedProjects = scopedProjects.filter((project) => project.status === "Terminado").length;
  const benefits = scopedProjects.reduce((total, project) => total + project.realizedBenefit, 0);
  const pendingEvaluation = scopedProjects.filter((project) => project.status === "Abierto").length;

  function addProject(project: ImprovementProject) {
    onProjectsChange([project, ...projects]);
    setSelectedProjectId(project.id);
    setActiveView("portfolio");
  }

  return (
    <div className="continuous-improvement-module">
      <section className="module-heading continuous-heading">
        <div><span className="module-kicker">Sistema de mejora</span><h2>Mejora continua</h2><p>Captura de ideas, priorización y seguimiento de proyectos Kaizen y DMAIC.</p></div>
        <span className={`continuous-access-role ${manager ? "manager" : "submitter"}`}>{manager ? "Gestión del portafolio" : "Registro y seguimiento"}</span>
      </section>

      <section className="continuous-summary" aria-label="Resumen del portafolio">
        <SummaryItem icon={<Lightbulb size={18} />} label="Ideas por evaluar" value={String(pendingEvaluation)} />
        <SummaryItem icon={<FolderKanban size={18} />} label="Proyectos activos" value={String(activeProjects)} />
        <SummaryItem icon={<CheckCircle2 size={18} />} label="Mejoras terminadas" value={String(closedProjects)} />
        <SummaryItem icon={<CircleDollarSign size={18} />} label="Beneficio validado" value={currency.format(benefits)} />
      </section>

      <div className="continuous-main-tabs" role="tablist" aria-label="Vistas de Mejora continua">
        <button className={activeView === "register" ? "active" : ""} type="button" onClick={() => setActiveView("register")}><Plus size={16} /> Cargar iniciativa</button>
        <button className={activeView === "portfolio" ? "active" : ""} type="button" onClick={() => setActiveView("portfolio")}><FolderKanban size={16} /> {manager ? "Plan general" : "Mis proyectos"}</button>
      </div>

      {activeView === "register"
        ? <ProjectRegistration session={session} sequence={projects.length + 1} onCreate={addProject} />
        : <ProjectPortfolio manager={manager} projects={projects} scopedProjects={scopedProjects} selectedProjectId={selectedProjectId} onSelect={setSelectedProjectId} onProjectsChange={onProjectsChange} />}
    </div>
  );
}

function ProjectRegistration({ session, sequence, onCreate }: { session: ActiveSession; sequence: number; onCreate: (project: ImprovementProject) => void }) {
  const availableProcesses = session.userType === "Administrador"
    ? processCatalog
    : processCatalog.filter((process) => session.assignedProcessIds.includes(process.id));
  const [mode, setMode] = useState<IntakeMode>("idea");
  const [type, setType] = useState<ImprovementProjectType>("kaizen");
  const [category, setCategory] = useState<ImprovementProjectCategory>("process");
  const [title, setTitle] = useState("");
  const [processId, setProcessId] = useState(session.userType === "Administrador" ? "P-08" : (session.assignedProcessIds[0] ?? ""));
  const [sponsor, setSponsor] = useState("");
  const [leader, setLeader] = useState(session.name);
  const [problem, setProblem] = useState("");
  const [objective, setObjective] = useState("");
  const [scope, setScope] = useState("");
  const [customer, setCustomer] = useState("");
  const [metric, setMetric] = useState("");
  const [baseline, setBaseline] = useState("");
  const [target, setTarget] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [targetDate, setTargetDate] = useState(addDaysIso(45));
  const [estimatedInvestment, setEstimatedInvestment] = useState(0);
  const [estimatedSavings, setEstimatedSavings] = useState(0);
  const [team, setTeam] = useState("");
  const [ideaEvidence, setIdeaEvidence] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isIdea = mode === "idea";
    const project = createImprovementProject({
      title,
      type: isIdea ? "kaizen" : type,
      category,
      intakeSource: isIdea ? "idea" : "direct",
      processId,
      submittedBy: session.name,
      sponsor: isIdea ? "Por asignar" : sponsor,
      leader: isIdea ? session.name : leader,
      problem,
      objective,
      scope: isIdea ? `Área de aplicación: ${processId}` : scope,
      customer: isIdea ? "Por definir" : customer,
      metric: isIdea ? "Por definir durante la evaluación" : metric,
      baseline: isIdea ? "Por definir" : baseline,
      target: isIdea ? "Por definir" : target,
      startDate,
      targetDate,
      estimatedInvestment: isIdea ? 0 : estimatedInvestment,
      estimatedSavings: isIdea ? 0 : estimatedSavings,
      team: isIdea ? [] : team.split(",").map((member) => member.trim()).filter(Boolean),
    }, sequence);
    if (ideaEvidence) {
      project.evidence = [{ id: `EVI-${Date.now()}`, name: ideaEvidence, uploadedBy: session.name, uploadedAt: new Date().toISOString() }];
    }
    onCreate(project);
  }

  return (
    <form className="continuous-registration work-panel" onSubmit={submit}>
      <header className="continuous-section-heading">
        <div><span>Ingreso de iniciativa</span><h3>{mode === "idea" ? "Captura de idea" : "Alta de proyecto"}</h3><p>{mode === "idea" ? "Registra la oportunidad; el encargado definirá la ruta y el alcance." : "Carga un proyecto ya estructurado para integrarlo al Plan General."}</p></div>
        <span className="continuous-request-code">MC-{new Date().getFullYear()}-{String(sequence).padStart(3, "0")}</span>
      </header>

      <div className="continuous-intake-switch" role="tablist" aria-label="Tipo de captura">
        <button className={mode === "idea" ? "active" : ""} type="button" onClick={() => setMode("idea")}><Lightbulb size={16} /><span><strong>Captura de idea</strong><small>Entrada breve basada en F-MC-003</small></span></button>
        <button className={mode === "project" ? "active" : ""} type="button" onClick={() => setMode("project")}><ClipboardList size={16} /><span><strong>Proyecto estructurado</strong><small>Carátula, métrica y economía</small></span></button>
      </div>

      {mode === "project" ? (
        <fieldset className="continuous-type-picker">
          <legend>Ruta de proyecto</legend>
          {(Object.keys(improvementProjectTypeLabels) as ImprovementProjectType[]).map((projectType) => (
            <label className={type === projectType ? "selected" : ""} key={projectType}>
              <input type="radio" name="project-type" value={projectType} checked={type === projectType} onChange={() => setType(projectType)} />
              <span className={`continuous-type-mark type-${projectType}`}>{projectType === "kaizen" ? <Users size={18} /> : <BarChart3 size={18} />}</span>
              <span><strong>{improvementProjectTypeLabels[projectType]}</strong><small>{improvementProjectTypeDescriptions[projectType]}</small></span>
              {type === projectType ? <Check size={16} /> : null}
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="continuous-form-section">
        <div className="continuous-form-section-title"><ClipboardList size={17} /><span><strong>{mode === "idea" ? "Datos de la idea" : "Carátula del proyecto"}</strong><small>{mode === "idea" ? "Oportunidad y mejora sugerida." : "Identificación, responsables y alcance."}</small></span></div>
        <div className="continuous-form-grid">
          <label className="span-2">{mode === "idea" ? "Título de la idea" : "Nombre del proyecto"}<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Resultado concreto que se busca" /></label>
          <label>Proceso o área<select required value={processId} onChange={(event) => setProcessId(event.target.value)}>{availableProcesses.length === 0 ? <option value="">Sin proceso asignado</option> : null}{availableProcesses.map((process) => <option key={process.id} value={process.id}>{process.id} · {process.name}</option>)}</select></label>
          <label>Origen<select value={category} onChange={(event) => setCategory(event.target.value as ImprovementProjectCategory)}>{(Object.keys(improvementProjectCategoryLabels) as ImprovementProjectCategory[]).map((item) => <option key={item} value={item}>{improvementProjectCategoryLabels[item]}</option>)}</select></label>
          {mode === "project" ? <><label>Patrocinador<input required value={sponsor} onChange={(event) => setSponsor(event.target.value)} placeholder="Puesto que respalda el proyecto" /></label><label>Líder<input required value={leader} onChange={(event) => setLeader(event.target.value)} /></label><label className="span-2">Cliente interno o externo<input required value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Área, proceso o cliente impactado" /></label></> : null}
          <label className="span-2">{mode === "idea" ? "Oportunidad o problema observado" : "Definición del problema"}<textarea required value={problem} onChange={(event) => setProblem(event.target.value)} placeholder="Qué ocurre, dónde y cuál es su impacto" /></label>
          <label className="span-2">{mode === "idea" ? "Mejora sugerida y resultado esperado" : "Objetivo SMART"}<textarea required value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Qué cambio propone y qué resultado espera" /></label>
          {mode === "project" ? <><label className="span-2">Alcance<textarea required value={scope} onChange={(event) => setScope(event.target.value)} placeholder="Procesos, productos, líneas o ubicaciones incluidas y excluidas" /></label><label className="span-2">Equipo multidisciplinario<input value={team} onChange={(event) => setTeam(event.target.value)} placeholder="Nombres o puestos separados por comas" /></label></> : <label className="span-2 continuous-file-field"><span>Evidencia inicial</span><span className="continuous-file-control"><Upload size={15} />{ideaEvidence || "Adjuntar fotografía o archivo"}</span><input type="file" onChange={(event) => setIdeaEvidence(event.target.files?.[0]?.name ?? "")} /></label>}
        </div>
      </div>

      {mode === "project" ? (
        <div className="continuous-form-section">
          <div className="continuous-form-section-title"><Target size={17} /><span><strong>Métrica y resultado esperado</strong><small>Línea base, meta y economía del proyecto.</small></span></div>
          <div className="continuous-form-grid three-columns">
            <label>Métrica<input required value={metric} onChange={(event) => setMetric(event.target.value)} placeholder="Ej. % de reproceso" /></label>
            <label>Línea base<input required value={baseline} onChange={(event) => setBaseline(event.target.value)} placeholder="Resultado actual" /></label>
            <label>Meta<input required value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Resultado objetivo" /></label>
            <label>Fecha de inicio<input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label>Fecha objetivo<input required min={startDate} type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label><span />
            <label>Inversión estimada<input min="0" type="number" value={estimatedInvestment} onChange={(event) => setEstimatedInvestment(Number(event.target.value))} /></label>
            <label>Ahorro estimado<input min="0" type="number" value={estimatedSavings} onChange={(event) => setEstimatedSavings(Number(event.target.value))} /></label>
            <div className="continuous-benefit-preview"><small>Beneficio estimado</small><strong>{currency.format(Math.max(0, estimatedSavings - estimatedInvestment))}</strong></div>
          </div>
        </div>
      ) : null}

      <footer className="continuous-form-footer"><span><FileCheck2 size={16} /> {mode === "idea" ? "La idea quedará abierta para evaluación." : "El proyecto se integrará al Plan General."}</span><button className="button button-primary" type="submit">{mode === "idea" ? "Registrar idea" : "Registrar proyecto"} <ArrowRight size={16} /></button></footer>
    </form>
  );
}

function ProjectPortfolio({ projects, scopedProjects, selectedProjectId, manager, onSelect, onProjectsChange }: { projects: ImprovementProject[]; scopedProjects: ImprovementProject[]; selectedProjectId: string; manager: boolean; onSelect: (id: string) => void; onProjectsChange: (projects: ImprovementProject[]) => void }) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ImprovementProjectType>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | ImprovementProjectCategory>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ImprovementProjectStatus>("all");
  const normalized = query.trim().toLocaleLowerCase("es-MX");
  const visibleProjects = useMemo(() => scopedProjects
    .filter((project) => typeFilter === "all" || project.type === typeFilter)
    .filter((project) => categoryFilter === "all" || project.category === categoryFilter)
    .filter((project) => statusFilter === "all" || project.status === statusFilter)
    .filter((project) => !normalized || `${project.code} ${project.title} ${project.processId} ${project.leader}`.toLocaleLowerCase("es-MX").includes(normalized))
    .sort((a, b) => calculateProjectScore(b.scorecard) - calculateProjectScore(a.scorecard)), [categoryFilter, normalized, scopedProjects, statusFilter, typeFilter]);
  const selectedProject = scopedProjects.find((project) => project.id === selectedProjectId) ?? visibleProjects[0] ?? scopedProjects[0];

  function updateProject(next: ImprovementProject) {
    onProjectsChange(projects.map((project) => project.id === next.id ? { ...next, updatedAt: new Date().toISOString() } : project));
  }

  return (
    <div className="continuous-portfolio-layout">
      <section className="continuous-project-index work-panel">
        <header className="continuous-section-heading portfolio-heading">
          <div><span>F-MC-002</span><h3>Plan General de Proyectos</h3><p>{visibleProjects.length} proyectos según los filtros actuales.</p></div>
          <div className="continuous-portfolio-filters">
            <label className="continuous-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar proyecto" aria-label="Buscar proyecto" /></label>
            <select aria-label="Filtrar por origen" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as "all" | ImprovementProjectCategory)}><option value="all">Todos los orígenes</option>{(Object.keys(improvementProjectCategoryLabels) as ImprovementProjectCategory[]).map((item) => <option key={item} value={item}>{improvementProjectCategoryLabels[item]}</option>)}</select>
            <select aria-label="Filtrar por ruta" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | ImprovementProjectType)}><option value="all">Todas las rutas</option><option value="kaizen">Kaizen</option><option value="dmaic">DMAIC</option></select>
            <select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | ImprovementProjectStatus)}><option value="all">Todos los estados</option>{projectStatuses.map((status) => <option key={status}>{status}</option>)}</select>
          </div>
        </header>
        <div className="continuous-table-wrap"><table className="continuous-project-table"><thead><tr><th>RPM</th><th>Número / proyecto</th><th>Origen</th><th>Ruta</th><th>Proceso</th><th>Líder</th><th>Métrica</th><th>Estado</th><th>Cumplimiento</th><th /></tr></thead><tbody>
          {visibleProjects.map((project) => {
            const rpm = calculateProjectRpmScore(project.scorecard);
            const compliance = calculateProjectCompliance(project.scorecard);
            return <tr className={selectedProject?.id === project.id ? "selected" : ""} key={project.id}>
              <td><span className="continuous-rpm"><strong>{rpm.toFixed(2)}</strong><small>/ {maximumRpmScore.toFixed(2)}</small></span></td>
              <td><strong>{project.title}</strong><small>{project.code}</small></td><td>{improvementProjectCategoryLabels[project.category]}</td><td><span className={`continuous-type-pill type-${project.type}`}>{improvementProjectTypeLabels[project.type]}</span></td><td>{project.processId}</td><td>{project.leader}</td><td>{project.metric}</td><td><span className={`continuous-status status-${statusClass(project.status)}`}>{project.status}</span></td><td><strong>{compliance}%</strong></td>
              <td><button className="icon-button" title="Abrir proyecto" type="button" onClick={() => onSelect(project.id)}><ArrowRight size={15} /></button></td>
            </tr>;
          })}
        </tbody></table>{visibleProjects.length === 0 ? <div className="continuous-no-results"><Search size={22} /><strong>Sin proyectos</strong><span>Ajusta los filtros para ampliar la búsqueda.</span></div> : null}</div>
      </section>
      {selectedProject ? <ProjectDetail key={selectedProject.id} manager={manager} project={selectedProject} onChange={updateProject} /> : null}
    </div>
  );
}

function ProjectDetail({ project, manager, onChange }: { project: ImprovementProject; manager: boolean; onChange: (project: ImprovementProject) => void }) {
  const [detailView, setDetailView] = useState<DetailView>("charter");
  const [newAction, setNewAction] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newDueDate, setNewDueDate] = useState(project.targetDate);
  const rpm = calculateProjectRpmScore(project.scorecard);
  const compliance = calculateProjectCompliance(project.scorecard);
  const progress = getProjectProgress(project);
  const activePhase = project.phases.find((phase) => phase.status === "active");

  function toggleTool(phaseId: string, toolId: string) {
    onChange({ ...project, phases: project.phases.map((phase) => phase.id === phaseId ? { ...phase, tools: phase.tools.map((tool) => tool.id === toolId ? { ...tool, status: tool.status === "completed" ? "pending" : "completed" } : tool) } : phase) });
  }

  function advancePhase() {
    const activeIndex = project.phases.findIndex((phase) => phase.status === "active");
    if (activeIndex < 0) return;
    const finished = activeIndex === project.phases.length - 1;
    onChange({
      ...project,
      status: finished ? "Terminado" : "En proceso",
      phases: project.phases.map((phase, index) => index <= activeIndex ? { ...phase, status: "completed", tools: phase.tools.map((tool) => ({ ...tool, status: "completed" })) } : index === activeIndex + 1 ? { ...phase, status: "active", tools: phase.tools.map((tool, toolIndex) => ({ ...tool, status: toolIndex === 0 ? "active" : "pending" })) } : phase),
    });
  }

  function addAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onChange({ ...project, actions: [...project.actions, { id: `ACT-${Date.now()}`, description: newAction, owner: newOwner, dueDate: newDueDate, status: "Pendiente" }] });
    setNewAction("");
    setNewOwner("");
  }

  function uploadEvidence(file: File | undefined) {
    if (!file) return;
    onChange({ ...project, evidence: [...project.evidence, { id: `EVI-${Date.now()}`, name: file.name, uploadedBy: project.improvementOwner, uploadedAt: new Date().toISOString(), phaseId: activePhase?.id }] });
  }

  return (
    <section className="continuous-project-detail work-panel">
      <header className="continuous-detail-header">
        <div><div className="continuous-detail-eyebrow"><span>{project.code}</span><span className={`continuous-type-pill type-${project.type}`}>{improvementProjectTypeLabels[project.type]}</span><span className="continuous-rpm-badge">RPM {rpm.toFixed(2)} · Cumplimiento {compliance}%</span></div><h3>{project.title}</h3><p>{improvementProjectCategoryLabels[project.category]} · {project.processId} · {project.leader} · Meta {formatDate(project.targetDate)}</p></div>
        <div className="continuous-detail-controls"><div className="continuous-detail-progress"><span><i style={{ width: `${progress}%` }} /></span><strong>{progress}%</strong></div>{manager ? <select aria-label="Estado del proyecto" value={project.status} onChange={(event) => onChange({ ...project, status: event.target.value as ImprovementProjectStatus })}>{projectStatuses.map((status) => <option key={status}>{status}</option>)}</select> : <span className={`continuous-status status-${statusClass(project.status)}`}>{project.status}</span>}</div>
      </header>
      <nav className="continuous-detail-tabs" aria-label="Detalle del proyecto">
        <button className={detailView === "charter" ? "active" : ""} type="button" onClick={() => setDetailView("charter")}><ClipboardList size={15} /> {project.type === "kaizen" ? "Reporte Kaizen" : "Project charter"}</button>
        <button className={detailView === "route" ? "active" : ""} type="button" onClick={() => setDetailView("route")}><Route size={15} /> Ruta y herramientas</button>
        <button className={detailView === "plan" ? "active" : ""} type="button" onClick={() => setDetailView("plan")}><ListChecks size={15} /> Plan y evidencias</button>
        <button className={detailView === "scorecard" ? "active" : ""} type="button" onClick={() => setDetailView("scorecard")}><Gauge size={15} /> Ponderación</button>
      </nav>
      {detailView === "charter" ? (project.type === "kaizen" ? <KaizenReportView manager={manager} project={project} onChange={onChange} /> : <ProjectCharter project={project} />) : null}
      {detailView === "route" ? <ProjectRoute project={project} manager={manager} onToggleTool={toggleTool} onAdvance={advancePhase} /> : null}
      {detailView === "plan" ? <ProjectPlan project={project} manager={manager} newAction={newAction} newOwner={newOwner} newDueDate={newDueDate} onNewAction={setNewAction} onNewOwner={setNewOwner} onNewDueDate={setNewDueDate} onAddAction={addAction} onUpdateAction={(actionId, status) => onChange({ ...project, actions: project.actions.map((action) => action.id === actionId ? { ...action, status } : action) })} onUploadEvidence={uploadEvidence} /> : null}
      {detailView === "scorecard" ? <ProjectScorecard manager={manager} project={project} onChange={onChange} /> : null}
    </section>
  );
}

function KaizenReportView({ project, manager, onChange }: { project: ImprovementProject; manager: boolean; onChange: (project: ImprovementProject) => void }) {
  const report = project.rapidImprovement ?? { kind: "Proceso" as const, beforeDescription: project.problem, improvementDescription: "Por documentar", releasedBy: "Gerente de Mejora Continua", approvedBy: "Dirección de Planta" };
  const update = (patch: Partial<typeof report>) => onChange({ ...project, rapidImprovement: { ...report, ...patch } });
  const evidenceField = (side: "before" | "improvement", label: string, fileName?: string) => (
    <label className={`rapid-evidence-zone ${side}`}>
      <ImageIcon size={24} />
      <strong>{label}</strong>
      <span>{fileName || "Adjuntar fotografía o evidencia"}</span>
      {manager ? <input type="file" onChange={(event) => update(side === "before" ? { beforeEvidenceName: event.target.files?.[0]?.name } : { improvementEvidenceName: event.target.files?.[0]?.name })} /> : null}
    </label>
  );
  return <div className="rapid-report">
    <header><div><span>F-MC-004</span><h4>Número Kaizen: {project.code}</h4></div><span className="continuous-status status-terminado">Reporte antes / después</span></header>
    <section className="rapid-problem"><small>Problemática</small>{manager ? <textarea value={report.beforeDescription} onChange={(event) => update({ beforeDescription: event.target.value })} /> : <p>{report.beforeDescription}</p>}</section>
    <div className="rapid-evidence-grid">{evidenceField("before", "Evidencias del problema", report.beforeEvidenceName)}{evidenceField("improvement", "Evidencias de la mejora", report.improvementEvidenceName)}</div>
    <div className="rapid-description-grid"><section><span>Antes</span>{manager ? <textarea value={report.beforeDescription} onChange={(event) => update({ beforeDescription: event.target.value })} /> : <p>{report.beforeDescription}</p>}</section><section><span>Mejora</span>{manager ? <textarea value={report.improvementDescription} onChange={(event) => update({ improvementDescription: event.target.value })} /> : <p>{report.improvementDescription}</p>}</section></div>
    <div className="rapid-info-grid">
      <RapidField label="Líder / dueño" value={project.leader} />
      <RapidField label="Fecha de mejora" value={formatDate(project.targetDate)} />
      <RapidField label="Proceso" value={project.processId} />
      <label><small>Tipo</small>{manager ? <select value={report.kind} onChange={(event) => update({ kind: event.target.value as RapidImprovementKind })}>{(["Documental", "Dispositivo", "Herramental", "Proceso", "Área"] as RapidImprovementKind[]).map((kind) => <option key={kind}>{kind}</option>)}</select> : <strong>{report.kind}</strong>}</label>
      <RapidField label="Ahorro" value={currency.format(project.realizedBenefit || project.estimatedSavings)} />
      <RapidField label="Liberó" value={report.releasedBy} editable={manager} onChange={(value) => update({ releasedBy: value })} />
      <RapidField label="Aprobó" value={report.approvedBy} editable={manager} onChange={(value) => update({ approvedBy: value })} />
      <label><small>Fecha de liberación</small>{manager ? <input type="date" value={report.releasedAt ?? ""} onChange={(event) => update({ releasedAt: event.target.value })} /> : <strong>{report.releasedAt ? formatDate(report.releasedAt) : "Pendiente"}</strong>}</label>
    </div>
  </div>;
}

function RapidField({ label, value, editable = false, onChange }: { label: string; value: string; editable?: boolean; onChange?: (value: string) => void }) {
  return <label><small>{label}</small>{editable ? <input value={value} onChange={(event) => onChange?.(event.target.value)} /> : <strong>{value}</strong>}</label>;
}

function ProjectCharter({ project }: { project: ImprovementProject }) {
  return <div className="continuous-charter"><div className="continuous-charter-main">
    <section><small>Definición del problema</small><p>{project.problem}</p></section><section><small>Objetivo SMART</small><p>{project.objective}</p></section><section><small>Alcance</small><p>{project.scope}</p></section>
    <div className="continuous-charter-grid"><div><small>Cliente</small><strong>{project.customer}</strong></div><div><small>Métrica</small><strong>{project.metric}</strong></div><div><small>Línea base</small><strong>{project.baseline}</strong></div><div><small>Meta</small><strong>{project.target}</strong></div></div>
  </div><aside className="continuous-charter-side">
    <section><small>Gobernanza</small><div><span>Patrocinador</span><strong>{project.sponsor}</strong></div><div><span>Líder</span><strong>{project.leader}</strong></div><div><span>Responsable MC</span><strong>{project.improvementOwner}</strong></div></section>
    <section><small>Equipo</small>{project.team.length ? project.team.map((member) => <span key={member}>{member}</span>) : <span>Por integrar</span>}</section>
    <section className="continuous-economics"><small>Economía del proyecto</small><div><span>Inversión estimada</span><strong>{currency.format(project.estimatedInvestment)}</strong></div><div><span>Ahorro estimado</span><strong>{currency.format(project.estimatedSavings)}</strong></div><div><span>Beneficio real</span><strong>{currency.format(project.realizedBenefit)}</strong></div></section>
  </aside></div>;
}

function ProjectRoute({ project, manager, onToggleTool, onAdvance }: { project: ImprovementProject; manager: boolean; onToggleTool: (phaseId: string, toolId: string) => void; onAdvance: () => void }) {
  const activePhase = project.phases.find((phase) => phase.status === "active");
  return <div className="continuous-route-view"><div className={`continuous-phase-strip phases-${project.phases.length}`}>{project.phases.map((phase, index) => <div className={phase.status} key={phase.id}><span>{phase.status === "completed" ? <Check size={14} /> : index + 1}</span><strong>{phase.name}</strong><small>{formatDate(phase.targetDate)}</small></div>)}</div>
    <div className="continuous-phase-tools">{project.phases.map((phase) => <section className={phase.status} key={phase.id}><header><span>{phase.name}</span><small>{phase.status === "completed" ? "Fase concluida" : phase.status === "active" ? "Fase actual" : `Programada ${formatDate(phase.targetDate)}`}</small></header><div>{phase.tools.map((tool) => <button disabled={!manager || project.status === "Terminado"} key={tool.id} type="button" onClick={() => onToggleTool(phase.id, tool.id)}><span className={`continuous-tool-check ${tool.status}`}>{tool.status === "completed" ? <Check size={13} /> : null}</span><span><strong>{tool.name}</strong><small>{tool.description}</small></span></button>)}</div></section>)}</div>
    {manager && activePhase ? <footer className="continuous-route-footer"><span><Route size={16} /> Gate actual: <strong>{activePhase.name}</strong>. Confirma los entregables antes de avanzar.</span><button className="button button-primary" type="button" onClick={onAdvance}>Concluir fase <ArrowRight size={16} /></button></footer> : null}
  </div>;
}

function ProjectPlan({ project, manager, newAction, newOwner, newDueDate, onNewAction, onNewOwner, onNewDueDate, onAddAction, onUpdateAction, onUploadEvidence }: { project: ImprovementProject; manager: boolean; newAction: string; newOwner: string; newDueDate: string; onNewAction: (value: string) => void; onNewOwner: (value: string) => void; onNewDueDate: (value: string) => void; onAddAction: (event: FormEvent<HTMLFormElement>) => void; onUpdateAction: (actionId: string, status: ImprovementAction["status"]) => void; onUploadEvidence: (file: File | undefined) => void }) {
  return <div className="continuous-plan-view"><section className="continuous-milestone-plan"><header><div><span>Hitos del proyecto</span><h4>Plan maestro</h4></div><small>{formatDate(project.startDate)} - {formatDate(project.targetDate)}</small></header><div>{project.phases.map((phase) => <article key={phase.id}><span className={phase.status}>{phase.status === "completed" ? <Check size={13} /> : null}</span><div><strong>{phase.name}</strong><small>{phase.tools.map((tool) => tool.name).join(" · ")}</small></div><time>{formatDate(phase.targetDate)}</time></article>)}</div></section>
    <section className="continuous-actions-plan"><header><div><span>Seguimiento</span><h4>Acciones y evidencias</h4></div><label className="continuous-evidence-upload"><Upload size={15} /><span>Adjuntar evidencia</span><input type="file" onChange={(event) => onUploadEvidence(event.target.files?.[0])} /></label></header>
      <div className="continuous-action-table-wrap"><table className="continuous-action-table"><thead><tr><th>Acción</th><th>Responsable</th><th>Fecha</th><th>Estado</th><th>Evidencia</th></tr></thead><tbody>{project.actions.map((action) => <tr key={action.id}><td>{action.description}</td><td>{action.owner}</td><td>{formatDate(action.dueDate)}</td><td>{manager ? <select value={action.status} onChange={(event) => onUpdateAction(action.id, event.target.value as ImprovementAction["status"])}><option>Pendiente</option><option>En curso</option><option>Completada</option></select> : action.status}</td><td>{action.evidenceName ?? "Pendiente"}</td></tr>)}</tbody></table>{project.actions.length === 0 ? <div className="continuous-action-empty">Aún no se han registrado acciones.</div> : null}</div>
      {manager ? <form className="continuous-action-entry" onSubmit={onAddAction}><input required value={newAction} onChange={(event) => onNewAction(event.target.value)} placeholder="Nueva acción" /><input required value={newOwner} onChange={(event) => onNewOwner(event.target.value)} placeholder="Responsable" /><input required type="date" value={newDueDate} onChange={(event) => onNewDueDate(event.target.value)} /><button className="button button-secondary" type="submit"><Plus size={15} /> Agregar</button></form> : null}
      <div className="continuous-evidence-list"><strong>Evidencias ({project.evidence.length})</strong>{project.evidence.map((evidence) => <span key={evidence.id}><FileCheck2 size={14} /><span><b>{evidence.name}</b><small>{evidence.uploadedBy} · {formatDateTime(evidence.uploadedAt)}</small></span></span>)}</div>
    </section></div>;
}

function ProjectScorecard({ project, manager, onChange }: { project: ImprovementProject; manager: boolean; onChange: (project: ImprovementProject) => void }) {
  const rpm = calculateProjectRpmScore(project.scorecard);
  const compliance = calculateProjectCompliance(project.scorecard);
  return <div className="continuous-scorecard-view"><header><div><span>F-MC-002</span><h4>Ponderación del proyecto</h4><p>Calificación conforme a los criterios y opciones del Plan General de Proyectos.</p></div><div className="continuous-score-totals"><div><strong>{rpm.toFixed(2)}</strong><span>/ {maximumRpmScore.toFixed(2)}</span><small>RPM</small></div><div><strong>{compliance}%</strong><small>Cumplimiento</small></div></div></header>
    <div className="continuous-score-table"><div className="score-heading"><span>Criterio</span><span>Peso</span><span>Calificación</span><span>Aporte RPM</span></div>{project.scorecard.map((criterion) => { const contribution = (criterion.rating * criterion.weight / 100).toFixed(2); return <div className="score-row" key={criterion.id}><span><strong>{criterion.label}</strong><small>{criterion.description}</small></span><b>{criterion.weight}%</b><span>{manager ? <select aria-label={`Calificación de ${criterion.label}`} value={criterion.rating} onChange={(event) => onChange({ ...project, scorecard: project.scorecard.map((item) => item.id === criterion.id ? { ...item, rating: Number(event.target.value) } : item) })}>{criterion.options.map((option) => <option key={option.value} value={option.value}>{option.value} · {option.label}</option>)}</select> : <strong>{criterion.rating} / {criterion.maxRating}</strong>}</span><b>{contribution}</b></div>; })}</div>
    <footer><span><Gauge size={15} /> RPM = Impacto 30% + Tiempo 10% + Desarrollo 20% + Implementación 20% + Documentación 10% + Capacitación 10%.</span><strong>Cumplimiento = Implementación 60% + Documentación 20% + Capacitación 20%</strong></footer>
  </div>;
}

function SummaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div>{icon}<span><small>{label}</small><strong>{value}</strong></span></div>;
}

function statusClass(status: ImprovementProjectStatus) {
  return status.toLocaleLowerCase("es-MX").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll(" ", "-");
}

function formatDate(value: string) {
  if (!value) return "Pendiente";
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(days: number) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
