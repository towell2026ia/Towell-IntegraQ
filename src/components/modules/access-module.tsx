"use client";

import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Eye,
  KeyRound,
  LockKeyhole,
  Mail,
  Pencil,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  accessRuleCatalog,
  permissionAreaCatalog,
  processCatalog,
  userTypeCatalog,
} from "@/lib/configuration-data";
import { organizationPositions as fallbackPositions, type OrganizationPosition } from "@/lib/organization-data";
import { loadOrganizationPositions, positionsChangedEvent } from "@/lib/organization-position-client";
import { workspaceModuleMeta } from "@/lib/navigation";
import {
  editableModulePermissionGroups,
  hasModuleAction,
  normalizeModulePermissions,
} from "@/lib/module-permissions";
import {
  customerQualityCatalog,
  supplierQualityCatalog,
} from "@/lib/quality-parties-data";
import type {
  ContinuousImprovementRole,
  DocumentAccessRole,
  ModuleActionPermission,
  ProcessDocumentAccess,
  UserType,
} from "@/lib/session-data";
import {
  createUserAccessAccount,
  derivePositionAccess,
  documentAccessRoleLabels,
  getAccountScopeLabel,
  refreshAccountFromOrganization,
  type UserAccessAccount,
} from "@/lib/user-access-data";

type AccessTab = "types" | "permissions" | "rules" | "users";

export function AccessModule() {
  const [activeTab, setActiveTab] = useState<AccessTab>("types");
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<UserAccessAccount[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [editingAccount, setEditingAccount] = useState<UserAccessAccount | null | undefined>(undefined);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [positions, setPositions] = useState<OrganizationPosition[]>(fallbackPositions);

  useEffect(() => {
    void loadAccounts();
  }, []);

  const refreshPositions = useCallback(async () => {
    try {
      const loaded = await loadOrganizationPositions();
      setPositions(loaded);
    } catch {
      setPositions((current) => current.length ? current : fallbackPositions);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refreshPositions);
    const refresh = () => { void refreshPositions(); };
    window.addEventListener(positionsChangedEvent, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(positionsChangedEvent, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshPositions]);

  async function loadAccounts(preferredUserId?: string) {
    setLoadingAccounts(true);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const payload = await readApiPayload<{
        accounts?: UserAccessAccount[];
        error?: string;
      }>(response);
      if (!response.ok || !payload.accounts) {
        throw new Error(payload.error ?? "No fue posible cargar los usuarios.");
      }
      setAccounts(payload.accounts);
      setSelectedUserId((current) =>
        preferredUserId && payload.accounts?.some((item) => item.id === preferredUserId)
          ? preferredUserId
          : payload.accounts?.some((item) => item.id === current)
            ? current
            : payload.accounts?.[0]?.id ?? "",
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No fue posible cargar los usuarios.");
    } finally {
      setLoadingAccounts(false);
    }
  }

  const normalized = query.trim().toLocaleLowerCase("es");
  const visibleTypes = userTypeCatalog.filter((item) =>
    [item.id, item.name, item.initialCount, item.defaultAccess, item.processScope, item.description].some(
      (value) => value.toLocaleLowerCase("es").includes(normalized),
    ),
  );
  const visiblePermissionAreas = permissionAreaCatalog.filter((item) =>
    [item.id, item.name, item.administrator, item.internalUser, item.customer, item.supplier].some((value) =>
      value.toLocaleLowerCase("es").includes(normalized),
    ),
  );
  const visibleRules = accessRuleCatalog.filter((item) =>
    [item.id, item.rule].some((value) =>
      value.toLocaleLowerCase("es").includes(normalized),
    ),
  );
  const visibleAccounts = accounts.filter((account) =>
    [account.id, account.fullName, account.email, account.userType, account.positionName ?? "", account.companyName ?? ""].some((value) =>
      value.toLocaleLowerCase("es").includes(normalized),
    ),
  );
  const activeAccounts = accounts.filter((account) => account.status === "active").length;

  async function saveAccount(account: UserAccessAccount) {
    const creating = !account.authUserId;
    setActionNotice("");
    const response = await fetch("/api/admin/users", {
      method: account.authUserId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(account),
    });
    const payload = await readApiPayload<{ error?: string; message?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error ?? "No fue posible guardar el usuario.");
    }
    await loadAccounts(account.id);
    setActionNotice(
      payload.message ??
        (creating
          ? `Usuario creado. Supabase envió la invitación a ${account.email}.`
          : "Usuario actualizado correctamente."),
    );
    setActiveTab("users");
    setEditingAccount(undefined);
  }

  return (
    <>
      <section className="module-heading">
        <div>
          <p className="module-kicker">Configuración base</p>
          <h2>Usuarios y acceso</h2>
          <p>El puesto del organigrama determina procesos, menús y permisos documentales.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => { setEditingAccount(null); setActiveTab("users"); }}>
          <UserPlus size={17} /> Nuevo usuario
        </button>
      </section>

      <section className="metric-grid" aria-label="Resumen de acceso">
        <AccessMetric icon={<Users size={18} />} label="Usuarios configurados" value={String(accounts.length)} tone="neutral" />
        <AccessMetric icon={<CheckCircle2 size={18} />} label="Usuarios activos" value={String(activeAccounts)} tone="success" />
        <AccessMetric icon={<Building2 size={18} />} label="Puestos disponibles" value={String(positions.length)} tone="warning" />
        <AccessMetric icon={<KeyRound size={18} />} label="Permisos definidos" value={String(permissionAreaCatalog.length)} tone="danger" />
      </section>

      {actionNotice ? <div className="form-success" role="status"><Mail size={16} /> {actionNotice}</div> : null}

      <section className="access-panel">
        <div className="access-panel-header">
          <div className="segmented-control" aria-label="Vistas de acceso">
            <button className={activeTab === "types" ? "segment-active" : ""} type="button" onClick={() => setActiveTab("types")}>Tipos de usuario</button>
            <button className={activeTab === "permissions" ? "segment-active" : ""} type="button" onClick={() => setActiveTab("permissions")}>Permisos</button>
            <button className={activeTab === "rules" ? "segment-active" : ""} type="button" onClick={() => setActiveTab("rules")}>Reglas</button>
            <button className={activeTab === "users" ? "segment-active" : ""} type="button" onClick={() => setActiveTab("users")}>Usuarios</button>
          </div>
          <label className="panel-search wide">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" aria-label="Buscar configuración de acceso" />
          </label>
        </div>

        {activeTab === "types" ? <UserTypesTable items={visibleTypes} /> : null}
        {activeTab === "permissions" ? <PermissionMatrix items={visiblePermissionAreas} /> : null}
        {activeTab === "rules" ? <AccessRules items={visibleRules} /> : null}
        {activeTab === "users" ? (
          loadingAccounts ? <div className="access-empty"><RefreshCw className="spin" size={24} /><p>Cargando usuarios y permisos...</p></div>
            : loadError ? <div className="access-empty"><LockKeyhole size={24} /><h3>No fue posible consultar Supabase</h3><p>{loadError}</p><button className="button button-secondary" type="button" onClick={() => void loadAccounts()}><RefreshCw size={15} /> Reintentar</button></div>
              : <UserAccountsWorkspace
                  accounts={visibleAccounts}
                  allAccounts={accounts}
                  selectedUserId={selectedUserId}
                  onSelect={setSelectedUserId}
                  onEdit={(account) => setEditingAccount(account)}
                  onChange={saveAccount}
                  positions={positions}
                />
        ) : null}
      </section>

      {editingAccount !== undefined ? (
        <UserAccountModal
          account={editingAccount}
          positions={positions}
          onClose={() => setEditingAccount(undefined)}
          onSave={saveAccount}
        />
      ) : null}
    </>
  );
}

async function readApiPayload<T extends { error?: string }>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(
      response.ok
        ? "El servidor no confirmó la operación. Intenta nuevamente."
        : `El servidor no pudo completar la operación (${response.status}).`,
    );
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      response.ok
        ? "El servidor devolvió una respuesta inválida."
        : `No fue posible completar la operación (${response.status}).`,
    );
  }
}

function UserAccountsWorkspace({
  accounts,
  allAccounts,
  selectedUserId,
  onSelect,
  onEdit,
  onChange,
  positions,
}: {
  accounts: UserAccessAccount[];
  allAccounts: UserAccessAccount[];
  selectedUserId: string;
  onSelect: (id: string) => void;
  onEdit: (account: UserAccessAccount) => void;
  onChange: (account: UserAccessAccount) => Promise<void>;
  positions: OrganizationPosition[];
}) {
  const selected = allAccounts.find((account) => account.id === selectedUserId) ?? accounts[0] ?? null;
  return (
    <div className="user-access-layout">
      <div className="user-account-list">
        <div className="user-account-list-heading"><strong>{accounts.length} usuarios</strong><span>Selecciona para revisar el cruce</span></div>
        {accounts.map((account) => (
          <button className={account.id === selected?.id ? "selected" : ""} key={account.id} type="button" onClick={() => onSelect(account.id)}>
            <span className="user-account-avatar">{getInitials(account.fullName)}</span>
            <span><strong>{account.fullName}</strong><small>{account.positionName ?? account.companyName ?? account.userType}</small></span>
            <span className={`user-account-state ${account.status}`}>{account.status === "active" ? "Activo" : "Inactivo"}</span>
            <ChevronRight size={15} />
          </button>
        ))}
        {accounts.length === 0 ? <div className="access-empty compact"><Users size={22} /><p>No hay usuarios que coincidan con la búsqueda.</p></div> : null}
      </div>
      {selected ? (
        <UserAccessDetail account={selected} positions={positions} onEdit={() => onEdit(selected)} onChange={onChange} />
      ) : (
        <div className="access-empty"><Users size={24} /><h3>Sin usuarios configurados</h3><p>Utiliza Nuevo usuario para iniciar la carga.</p></div>
      )}
    </div>
  );
}

function UserAccessDetail({ account, positions, onEdit, onChange }: { account: UserAccessAccount; positions: OrganizationPosition[]; onEdit: () => void; onChange: (account: UserAccessAccount) => Promise<void> }) {
  const position = positions.find((item) => item.id === account.positionId);
  const parent = position?.parentId ? positions.find((item) => item.id === position.parentId) : undefined;
  return (
    <div className="user-access-detail">
      <header>
        <span className="detail-eyebrow"><Users size={14} /> {account.id}</span>
        <h3>{account.fullName}</h3>
        <p><Mail size={13} /> {account.email || "Correo pendiente"}</p>
        <div className="user-detail-actions">
          <button className="icon-button" type="button" title="Editar usuario" aria-label="Editar usuario" onClick={onEdit}><Pencil size={16} /></button>
          <button className="icon-button" type="button" title={account.status === "active" ? "Desactivar usuario" : "Reactivar usuario"} aria-label={account.status === "active" ? "Desactivar usuario" : "Reactivar usuario"} onClick={() => void onChange({ ...account, status: account.status === "active" ? "inactive" : "active" })}><Power size={16} /></button>
        </div>
      </header>
      <div className="user-access-facts">
        <div><small>Tipo</small><strong>{account.userType}</strong></div>
        <div><small>Puesto / empresa</small><strong>{account.positionName ?? account.companyName ?? "Pendiente"}</strong></div>
        <div><small>Reporta a</small><strong>{parent?.name ?? (position ? "Máxima autoridad" : "No aplica")}</strong></div>
        <div><small>Alcance</small><strong>{getAccountScopeLabel(account)}</strong></div>
      </div>

      {account.userType === "Usuario interno" ? (
        <button className="organization-refresh" type="button" onClick={() => void onChange(refreshAccountFromOrganization(account, positions))}>
          <RefreshCw size={15} /><span><strong>Restablecer desde organigrama</strong><small>Vuelve a aplicar la propuesta de procesos y permisos del puesto {account.positionId}.</small></span>
        </button>
      ) : null}

      <section className="user-access-section">
        <div className="section-title-row"><h4>Información documentada por proceso</h4><span className="count-badge">{account.documentAccess.length || (account.userType === "Administrador" ? "Todos" : 0)}</span></div>
        {account.userType === "Administrador" ? <div className="user-full-access"><ShieldCheck size={17} /> Control total: visor, modificador, autorizador e historial.</div> : null}
        <div className="user-document-access-list">
          {account.documentAccess.map((access) => {
            const process = processCatalog.find((item) => item.id === access.processId);
            return <div key={access.processId}><span><strong>{access.processId}</strong><small>{process?.name ?? "Proceso"}</small></span><span className={`document-role ${access.role}`}>{documentAccessRoleLabels[access.role]}</span></div>;
          })}
        </div>
        {!account.documentAccess.length && account.userType !== "Administrador" ? <div className="user-access-empty"><LockKeyhole size={16} /> Sin acceso a documentación interna.</div> : null}
      </section>

      {(account.userType === "Administrador" || account.userType === "Usuario interno") ? (
        <section className="user-access-section">
          <div className="section-title-row"><h4>Acciones por módulo</h4><span className="count-badge">{account.userType === "Administrador" ? "Todas" : account.moduleActionPermissions.length}</span></div>
          {account.userType === "Administrador" ? <div className="user-full-access"><SlidersHorizontal size={17} /> Puede consultar, crear, modificar, autorizar y administrar todos los módulos.</div> : (
            <div className="user-capability-summary">
              {editableModulePermissionGroups.map((group) => {
                const enabled = group.capabilities.filter((capability) => hasModuleAction(account.moduleActionPermissions, group.moduleId, capability.action));
                if (!enabled.length) return null;
                return <div key={group.moduleId}><strong>{group.label}</strong><span>{enabled.map((capability) => capability.label).join(" · ")}</span></div>;
              })}
            </div>
          )}
        </section>
      ) : null}

      <section className="user-access-section">
        <div className="section-title-row"><h4>Menús visibles</h4><span className="count-badge">{account.assignedModuleIds.length}</span></div>
        <div className="user-module-list">{account.assignedModuleIds.map((module) => <span key={module}>{workspaceModuleMeta[module].label}</span>)}</div>
      </section>

      {(account.userType === "Administrador" || account.userType === "Usuario interno") ? (
        <section className="user-access-section">
          <div className="section-title-row"><h4>Mejora continua</h4><span className="count-badge">{account.continuousImprovementRole === "manager" || account.userType === "Administrador" ? "Encargado" : "Solicitante"}</span></div>
          <div className="user-full-access"><TrendingUp size={17} /> {account.continuousImprovementRole === "manager" || account.userType === "Administrador" ? "Clasifica, pondera, autoriza fases y cierra proyectos." : "Registra proyectos y consulta los propios o asignados."}</div>
        </section>
      ) : null}
    </div>
  );
}

function UserAccountModal({ account, positions, onClose, onSave }: { account: UserAccessAccount | null; positions: OrganizationPosition[]; onClose: () => void; onSave: (account: UserAccessAccount) => Promise<void> }) {
  const [fullName, setFullName] = useState(account?.fullName ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [userType, setUserType] = useState<UserType>(account?.userType ?? "Usuario interno");
  const [positionId, setPositionId] = useState(account?.positionId ?? "");
  const [companyId, setCompanyId] = useState(account?.companyId ?? "");
  const [documentAccess, setDocumentAccess] = useState<ProcessDocumentAccess[]>(account?.documentAccess ?? []);
  const [moduleActionPermissions, setModuleActionPermissions] = useState<ModuleActionPermission[]>(account?.moduleActionPermissions ?? []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const internal = userType === "Administrador" || userType === "Usuario interno";
  const companyCatalog = userType === "Cliente" ? customerQualityCatalog : supplierQualityCatalog;
  const continuousImprovementRole: ContinuousImprovementRole = hasModuleAction(
    moduleActionPermissions,
    "continuous-improvement",
    "manage",
  ) ? "manager" : "submitter";

  function selectPosition(nextPositionId: string) {
    setPositionId(nextPositionId);
    const suggested = derivePositionAccess(nextPositionId, positions);
    setDocumentAccess(suggested?.documentAccess ?? []);
    setModuleActionPermissions(suggested?.moduleActionPermissions ?? []);
  }

  function changeUserType(nextType: UserType) {
    setUserType(nextType);
    setPositionId("");
    setCompanyId("");
    setDocumentAccess([]);
    setModuleActionPermissions([]);
  }

  function toggleProcess(processId: string) {
    setDocumentAccess((current) => {
      const exists = current.some((permission) => permission.processId === processId);
      return exists
        ? current.filter((permission) => permission.processId !== processId)
        : [...current, {
            processId,
            role: "viewer",
            inheritedFromPositionId: "ASIGNACION-DIRECTA",
          }];
    });
  }

  function setProcessRole(processId: string, role: DocumentAccessRole) {
    setDocumentAccess((current) => current.map((permission) =>
      permission.processId === processId
        ? { ...permission, role, inheritedFromPositionId: "ASIGNACION-DIRECTA" }
        : permission,
    ));
  }

  function toggleModuleAction(permission: ModuleActionPermission) {
    setModuleActionPermissions((current) => {
      const enabled = hasModuleAction(
        current,
        permission.moduleId,
        permission.action,
      );
      if (enabled) {
        return permission.action === "view"
          ? current.filter((item) => item.moduleId !== permission.moduleId)
          : current.filter((item) =>
              item.moduleId !== permission.moduleId ||
              item.action !== permission.action,
            );
      }
      return normalizeModulePermissions([...current, permission]);
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError("");
    const company = companyCatalog.find((item) => item.id === companyId);
    const built = createUserAccessAccount({
      id: account?.id ?? `USR-${Date.now()}`,
      fullName,
      email,
      userType,
      positionId: internal ? positionId : undefined,
      companyId: internal ? undefined : company?.id,
      companyName: internal ? undefined : company?.name,
      continuousImprovementRole: userType === "Usuario interno" ? continuousImprovementRole : undefined,
      documentAccess: userType === "Usuario interno" ? documentAccess : undefined,
      moduleActionPermissions: userType === "Usuario interno" ? moduleActionPermissions : undefined,
      positionCatalog: positions,
      createdAt: account?.createdAt ?? new Date().toISOString(),
    });
    if (!built) {
      setSaveError("Completa el puesto o la empresa vinculada.");
      return;
    }
    setSaving(true);
    try {
      await onSave(account ? {
        ...built,
        id: account.id,
        authUserId: account.authUserId,
        status: account.status,
      } : built);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "No fue posible guardar el usuario.");
      setSaving(false);
    }
  }

  return (
    <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="quality-modal user-account-modal" role="dialog" aria-modal="true" aria-labelledby="user-account-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>Usuario · Puesto · Permisos</span><h3 id="user-account-title">{account ? "Editar usuario" : "Nuevo usuario"}</h3></div><button className="icon-button" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>
        <form onSubmit={submit}>
          <div className="user-account-form-grid">
            <label className="wide">Nombre completo<input required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label className="wide">Correo de acceso<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Tipo de usuario<select value={userType} onChange={(event) => changeUserType(event.target.value as UserType)}><option>Administrador</option><option>Usuario interno</option><option>Cliente</option><option>Proveedor</option></select></label>
            {internal ? <label>Puesto del organigrama<select required value={positionId} onChange={(event) => selectPosition(event.target.value)}><option value="">Seleccionar puesto</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.id} · {position.name}</option>)}</select></label> : null}
            {!internal ? <label>Empresa vinculada<select required value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">Seleccionar empresa</option>{companyCatalog.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label> : null}
          </div>

          {userType === "Administrador" ? <div className="user-inheritance-preview"><div><ShieldCheck size={18} /><span><strong>Acceso total</strong><small>Todos los procesos, menús, acciones y configuraciones.</small></span></div></div> : null}

          {userType === "Usuario interno" ? (
            <div className="user-permission-editor">
              <section className="process-permission-editor">
                <header><div><span>Alcance operativo</span><h4>Procesos asignados</h4></div><strong>{documentAccess.length}</strong></header>
                <div className="process-permission-list">
                  {processCatalog.map((process) => {
                    const access = documentAccess.find((permission) => permission.processId === process.id);
                    const modifier = access?.role === "modifier" || access?.role === "authorizer";
                    return <div className={`${access ? "assigned" : ""} ${process.level === "subprocess" ? "subprocess" : ""}`} key={process.id}>
                      <label className="process-assignment-toggle"><input type="checkbox" checked={Boolean(access)} onChange={() => toggleProcess(process.id)} /><span><strong>{process.id} · {process.name}</strong><small>{process.level === "subprocess" ? "Subproceso" : "Proceso"}</small></span></label>
                      {access ? <div className="process-role-controls">
                        <div className="mini-segmented" aria-label={`Nivel para ${process.name}`}>
                          <button className={!modifier ? "active" : ""} type="button" onClick={() => setProcessRole(process.id, "viewer")}><Eye size={13} /> Visor</button>
                          <button className={modifier ? "active" : ""} type="button" onClick={() => setProcessRole(process.id, "modifier")}><Pencil size={13} /> Modificador</button>
                        </div>
                        <label className={`authorizer-toggle ${modifier ? "" : "disabled"}`}><input type="checkbox" disabled={!modifier} checked={access.role === "authorizer"} onChange={(event) => setProcessRole(process.id, event.target.checked ? "authorizer" : "modifier")} /> Autoriza documentos</label>
                      </div> : null}
                    </div>;
                  })}
                </div>
              </section>

              <section className="module-permission-editor">
                <header><div><span>Capacidades</span><h4>Acciones por módulo</h4></div><strong>{moduleActionPermissions.length}</strong></header>
                <div className="module-permission-groups">
                  {editableModulePermissionGroups.map((group) => <fieldset key={group.moduleId}>
                    <legend>{group.label}</legend>
                    {group.capabilities.map((capability) => {
                      const checked = hasModuleAction(moduleActionPermissions, group.moduleId, capability.action);
                      return <label className={checked ? "enabled" : ""} key={capability.action}><input type="checkbox" checked={checked} onChange={() => toggleModuleAction({ moduleId: group.moduleId, action: capability.action })} /><span><strong>{capability.label}</strong><small>{capability.description}</small></span></label>;
                    })}
                  </fieldset>)}
                </div>
              </section>
            </div>
          ) : null}

          {saveError ? <div className="form-error" role="alert">{saveError}</div> : null}
          <footer><button className="button button-secondary" disabled={saving} type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={saving} type="submit">{saving ? <RefreshCw className="spin" size={16} /> : <UserPlus size={16} />} {saving ? "Guardando..." : account ? "Guardar cambios" : "Crear usuario"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function UserTypesTable({ items }: { items: typeof userTypeCatalog[number][] }) {
  return <div className="access-table-wrap"><table className="access-table"><thead><tr><th>ID</th><th>Tipo de usuario</th><th>Cantidad inicial</th><th>Acceso base</th><th>Procesos visibles</th><th>Estado</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><code>{item.id}</code></td><td><strong>{item.name}</strong><small className="access-cell-detail">{item.description}</small></td><td>{item.initialCount}</td><td>{item.defaultAccess}</td><td>{item.processScope}</td><td><span className="status-badge status-open">{item.status}</span></td></tr>)}</tbody></table></div>;
}

function PermissionMatrix({ items }: { items: typeof permissionAreaCatalog[number][] }) {
  return <div className="access-table-wrap"><table className="access-table access-permissions-table"><thead><tr><th>ID</th><th>Función o permiso</th><th>Administrador</th><th>Usuario interno</th><th>Cliente</th><th>Proveedor</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><code>{item.id}</code></td><td><strong>{item.name}</strong></td><td><span className="access-value access-value-admin">{item.administrator}</span></td><td><span className="access-value access-value-user">{item.internalUser}</span></td><td><span className="access-value access-value-external">{item.customer}</span></td><td><span className="access-value access-value-external">{item.supplier}</span></td></tr>)}</tbody></table></div>;
}

function AccessRules({ items }: { items: typeof accessRuleCatalog[number][] }) {
  return <div className="access-rules-list">{items.map((item) => <article key={item.id}><code>{item.id}</code><p>{item.rule}</p><span className="permission-status">Obligatoria</span></article>)}</div>;
}

function AccessMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "neutral" | "success" | "warning" | "danger" }) {
  return <div className={`metric metric-${tone}`}><span className="metric-icon">{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div>;
}

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("es-MX");
}
