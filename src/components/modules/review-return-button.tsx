import { ArrowLeft } from "lucide-react";
import { canAccessModule } from "@/lib/access-policy";
import { isAdministrator, type ActiveSession } from "@/lib/session-data";
import type { WorkspaceModuleId } from "@/lib/navigation";
import styles from "./management-review-portal.module.css";

export function canReturnFromReview(session: ActiveSession, fromReview: boolean, destination: WorkspaceModuleId) {
  return fromReview && Boolean(session.authUserId && session.organizationId) && isAdministrator(session)
    && canAccessModule(session, "management-review") && canAccessModule(session, destination);
}

export function ReviewReturnButton({ onReturn }: { onReturn: () => void }) {
  return <button type="button" className={`button button-secondary print-hidden ${styles.returnButton}`} onClick={onReturn}>
    <ArrowLeft size={16} aria-hidden="true" />Regresar a Revisión por la Dirección
  </button>;
}
