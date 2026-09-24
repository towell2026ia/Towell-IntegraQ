"use client";

import { FolderLock } from "lucide-react";

import { EvidenceManager } from "@/components/evidence/evidence-manager";
import { workspaceModuleMeta, type WorkspaceModuleId } from "@/lib/navigation";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";

export function ModuleDocumentsPanel({
  moduleId,
  session,
}: {
  moduleId: WorkspaceModuleId;
  session: ActiveSession;
}) {
  const administrator = isAdministrator(session);
  const moduleLabel = workspaceModuleMeta[moduleId].label;

  return (
    <section className="module-documents-panel" aria-label={`Documentos de ${moduleLabel}`}>
      <div className="module-documents-heading">
        <span><FolderLock size={19} /></span>
        <div>
          <p className="module-kicker">Expediente del menú</p>
          <h2>Documentos de {moduleLabel}</h2>
          <p>
            {administrator
              ? "Como administrador puedes cargar, editar, eliminar y consultar los documentos de este menú."
              : "Puedes consultar los documentos disponibles. La carga, edición y eliminación están reservadas al administrador."}
          </p>
        </div>
        <span className={`module-documents-access ${administrator ? "administrator" : "readonly"}`}>
          {administrator ? "Control administrativo" : "Solo lectura"}
        </span>
      </div>
      <EvidenceManager
        addLabel="Cargar documento"
        description={administrator ? "Versionado e historial protegidos" : "Consulta y descarga autorizadas"}
        moduleId={moduleId}
        permissions={{
          read: true,
          add: administrator,
          replace: administrator,
          delete: administrator,
          history: administrator,
        }}
        resourceKey={moduleId}
        resourceType="module_document"
        title="Archivos del menú"
      />
    </section>
  );
}
