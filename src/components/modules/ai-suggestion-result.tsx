import { Check, FileSearch, Plus, ShieldAlert } from "lucide-react";

import type { AiRootCauseDraft } from "@/lib/types";

export function AiSuggestionResult({
  draft,
  onUseRootCause,
  onAddSuggestedAction,
}: {
  draft: AiRootCauseDraft;
  onUseRootCause?: (value: string) => void;
  onAddSuggestedAction?: (value: string) => void;
}) {
  const sources = draft.contextSources;

  return (
    <div className="ai-result">
      <p>{draft.summary}</p>

      {sources ? (
        <div className="ai-context-sources" aria-label="Contexto utilizado por la IA">
          <div><small>Proceso</small><strong>{sources.processId ? `${sources.processId} · ${sources.processName}` : "Sin coincidencia"}</strong></div>
          <div><small>Expediente A3</small><strong>{sources.a3Sections.length} secciones</strong></div>
          <div><small>Documentación</small><strong>{sources.documents.length} documentos indexados</strong></div>
        </div>
      ) : null}

      {sources?.documents.length === 0 ? (
        <div className="ai-document-gap">
          <FileSearch size={15} />
          <span><strong>Sin contenido documental consultable</strong><small>Las familias están configuradas, pero todavía no hay archivos indexados para este proceso.</small></span>
        </div>
      ) : null}

      <div className="ai-columns">
        <div>
          <h5>Preguntas guía</h5>
          <ol>
            {draft.fiveWhys.map((why) => (
              <li key={why}>{why}</li>
            ))}
          </ol>
        </div>
        <div>
          <h5>Hipótesis inicial</h5>
          <p>{draft.probableRootCause}</p>
          {onUseRootCause ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => onUseRootCause(draft.probableRootCause)}
            >
              <Check size={15} /> Usar como borrador
            </button>
          ) : null}
        </div>
      </div>

      <section className="ai-suggested-actions">
        <h5>Acciones sugeridas</h5>
        <div>
          {draft.suggestedActions.map((action) => (
            <article key={action}>
              <span>{action}</span>
              {onAddSuggestedAction ? (
                <button
                  type="button"
                  title="Agregar al plan de acción"
                  aria-label={`Agregar al plan: ${action}`}
                  onClick={() => onAddSuggestedAction(action)}
                >
                  <Plus size={14} />
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {draft.warnings.length ? (
        <div className="ai-warnings">
          <ShieldAlert size={15} />
          <ul>{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}
