"use client";

import {
  Building2,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  LockKeyhole,
  Mail,
  Pencil,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  accessRuleCatalog,
  permissionAreaCatalog,
  processCatalog,
  userTypeCatalog,
} from "@/lib/configuration-data";
import {
  getPositionParent,
  organizationPositions,
} from "@/lib/organization-data";
import { workspaceModuleMeta } from "@/lib/navigation";
import {
  customerQualityCatalog,
  supplierQualityCatalog,
} from "@/lib/quality-parties-data";
import type { ContinuousImprovementRole, UserType } from "@/lib/session-data";
import {
  createUserAccessAccount,
  derivePositionAccess,
  documentAccessRoleLabels,
  getAccountScopeLabel,
  initialUserAccessAccounts,
  refreshAccountFromOrganization,
  type UserAccessAccount,
} from "@/lib/user-access-data";

type AccessTab = "types" | "permissions" | "rules" | "users";

const userStorageKey = "integraq.userAccessAccounts.v1";

export function AccessModule() {
  const [activeTab, setActiveTab] = useState<AccessTab>("types");
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<UserAccessAccount[]>(initialUserAccessAccounts);
  const [selectedUserId, setSelectedUserId] = useState(initialUserAccessAccounts[0]?.id ?? "");
  const [editingAccount, setEditingAccount] = useState<UserAccessAccount | null | undefined>(undefined);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    const task = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(userStorageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as UserAccessAccount[];
          setAccounts(parsed);
          setSelectedUserId(parsed[0]?.id ?? "");
        }
      } catch {
        // The local configuration remains usable with seed data.
      } finally {
        setStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(userStorageKey, JSON.stringify(accounts));
  }, [accounts, storageReady]);

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

  function saveAccount(account: UserAccessAccount) {
    setAccounts((current) => {
      const exists = current.some((item) => item.id === account.id);
      return exists
        ? current.map((item) => item.id === account.id ? account : item)
        : [account, ...current];
    });
    setSelectedUserId(account.id);
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
        <AccessMetric icon={<Building2 size={18} />} label="Puestos disponibles" value={String(organizationPositions.length)} tone="warning" />
        <AccessMetric icon={<KeyRound size={18} />} label="Permisos definidos" value={String(permissionAreaCatalog.length)} tone="danger" />
      </section>

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
          <UserAccountsWorkspace
            accounts={visibleAccounts}
            allAccounts={accounts}
            selectedUserId={selectedUserId}
            onSelect={setSelectedUserId}
            onEdit={(account) => setEditingAccount(account)}
            onChange={(account) => setAccounts((current) => current.map((item) => item.id === account.id ? account : item))}
          />
        ) : null}
      </section>

      {editingAccount !== undefined ? (
        <UserAccountModal
          account={editingAccount}
          onClose={() => setEditingAccount(undefined)}
          onSave={saveAccount}
        />
      ) : null}
    </>
  );
}

function UserAccountsWorkspace({
  accounts,
  allAccounts,
  selectedUserId,
  onSelect,
  onEdit,
  onChange,
}: {
  accounts: UserAccessAccount[];
  allAccounts: UserAccessAccount[];
  selectedUserId: string;
  onSelect: (id: string) => void;
  onEdit: (account: UserAccessAccount) => void;
  onChange: (account: UserAccessAccount) => void;
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
        <UserAccessDetail account={selected} onEdit={() => onEdit(selected)} onChange={onChange} />
      ) : (
        <div className="access-empty"><Users size={24} /><h3>Sin usuarios configurados</h3><p>Utiliza Nuevo usuario para iniciar la carga.</p></div>
      )}
    </div>
  );
}

function UserAccessDetail({ account, onEdit, onChange }: { account: UserAccessAccount; onEdit: () => void; onChange: (account: UserAccessAccount) => void }) {
  const position = organizationPositions.find((item) => item.id === account.positionId);
  const parent = position ? getPositionParent(position) : undefined;
  return (
    <div className="user-access-detail">
      <header>
        <span className="detail-eyebrow"><Users size={14} /> {account.id}</span>
        <h3>{account.fullName}</h3>
        <p><Mail size={13} /> {account.email || "Correo pendiente"}</p>
        <div className="user-detail-actions">
          <button className="icon-button" type="button" title="Editar usuario" aria-label="Editar usuario" onClick={onEdit}><Pencil size={16} /></button>
          <button className="icon-button" type="button" title={account.status === "active" ? "Desactivar usuario" : "Reactivar usuario"} aria-label={account.status === "active" ? "Desactivar usuario" : "Reactivar usuario"} onClick={() => onChange({ ...account, status: account.status === "active" ? "inactive" : "active" })}><Power size={16} /></button>
        </div>
      </header>
      <div className="user-access-facts">
        <div><small>Tipo</small><strong>{account.userType}</strong></div>
        <div><small>Puesto / empresa</small><strong>{account.positionName ?? account.companyName ?? "Pendiente"}</strong></div>
        <div><small>Reporta a</small><strong>{parent?.name ?? (position ? "Máxima autoridad" : "No aplica")}</strong></div>
        <div><small>Alcance</small><strong>{getAccountScopeLabel(account)}</strong></div>
      </div>

      {account.userType === "Usuario interno" ? (
        <button className="organization-refresh" type="button" onClick={() => onChange(refreshAccountFromOrganization(account))}>
          <RefreshCw size={15} /><span><strong>Actualizar desde organigrama</strong><small>Recalcula procesos, menús y permisos del puesto {account.positionId}.</small></span>
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

function UserAccountModal({ account, onClose, onSave }: { account: UserAccessAccount | null; onClose: () => void; onSave: (account: UserAccessAccount) => void }) {
  const [fullName, setFullName] = useState(account?.fullName ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [userType, setUserType] = useState<UserType>(account?.userType ?? "Usuario interno");
  const [positionId, setPositionId] = useState(account?.positionId ?? "");
  const [companyId, setCompanyId] = useState(account?.companyId ?? "");
  const [continuousImprovementRole, setContinuousImprovementRole] = useState<ContinuousImprovementRole>(account?.continuousImprovementRole ?? "submitter");
  const internal = userType === "Administrador" || userType === "Usuario interno";
  const companyCatalog = userType === "Cliente" ? customerQualityCatalog : supplierQualityCatalog;
  const inherited = useMemo(() => positionId ? derivePositionAccess(positionId) : null, [positionId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      createdAt: account?.createdAt ?? new Date().toISOString(),
    });
    if (built) onSave(account ? { ...built, status: account.status } : built);
  }

  return (
    <div className="quality-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="quality-modal user-account-modal" role="dialog" aria-modal="true" aria-labelledby="user-account-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>Usuario · Puesto · Permisos</span><h3 id="user-account-title">{account ? "Editar usuario" : "Nuevo usuario"}</h3></div><button className="icon-button" type="button" title="Cerrar" aria-label="Cerrar" onClick={onClose}><X size={17} /></button></header>
        <form onSubmit={submit}>
          <div className="user-account-form-grid">
            <label className="wide">Nombre completo<input required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label className="wide">Correo de acceso<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Tipo de usuario<select value={userType} onChange={(event) => { setUserType(event.target.value as UserType); setPositionId(""); setCompanyId(""); }}><option>Administrador</option><option>Usuario interno</option><option>Cliente</option><option>Proveedor</option></select></label>
            {internal ? <label>Puesto del organigrama<select required value={positionId} onChange={(event) => setPositionId(event.target.value)}><option value="">Seleccionar puesto</option>{organizationPositions.map((position) => <option key={position.id} value={position.id}>{position.id} · {position.name}</option>)}</select></label> : null}
            {userType === "Usuario interno" ? <label>Rol en Mejora continua<select value={continuousImprovementRole} onChange={(event) => setContinuousImprovementRole(event.target.value as ContinuousImprovementRole)}><option value="submitter">Solicitante</option><option value="manager">Encargado de Mejora continua</option></select></label> : null}
            {!internal ? <label>Empresa vinculada<select required value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">Seleccionar empresa</option>{companyCatalog.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label> : null}
          </div>

          <div className="user-inheritance-preview">
            <div><ShieldCheck size={18} /><span><strong>Acceso calculado</strong><small>{userType === "Administrador" ? "Todos los procesos, menús y permisos." : internal && inherited ? `${inherited.assignedProcessIds.length} procesos · ${inherited.assignedModuleIds.length} menús derivados de ${inherited.position.id}.` : !internal && companyId ? "Un solo portal, aislado por ID de empresa." : "Selecciona el puesto o empresa para calcular el acceso."}</small></span></div>
            {internal && inherited ? <div className="user-inheritance-roles">{inherited.documentAccess.slice(0, 8).map((access) => <span key={access.processId}>{access.processId} · {documentAccessRoleLabels[access.role]}</span>)}</div> : null}
          </div>
          <footer><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit"><UserPlus size={16} /> {account ? "Guardar cambios" : "Crear usuario"}</button></footer>
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
