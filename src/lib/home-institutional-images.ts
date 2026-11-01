import { getDocumentPermissions, type ControlledDocument } from "./document-control-data";
import { isAdministrator, type ActiveSession } from "./session-data";

export const institutionalImageTitles = ["Política de Calidad", "Política Ambiental", "Política de Seguridad e Higiene", "Objetivos de Calidad"] as const;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\.[^.]+$/, "").trim().toLocaleLowerCase("es");
export function findInstitutionalImages(documents: ControlledDocument[], session: ActiveSession) {
  return institutionalImageTitles.map(title => {
    const matches = documents.filter(document => !document.lifecycle?.isDeleted && document.lifecycle?.status !== "obsolete"
      && getDocumentPermissions(session, document.processId).view
      && (normalize(document.name) === normalize(title) || document.versions.some(version => normalize(version.fileName) === normalize(title))));
    // An ambiguous match needs explicit administrative review, never an arbitrary winner.
    const document = matches.length === 1 ? matches[0] : undefined;
    const current = document?.versions.find(version => version.status === "current");
    const version = current ?? (isAdministrator(session) ? document?.versions.find(version => version.status === "pending") : undefined);
    return { title, document, version, ambiguous: matches.length > 1 };
  });
}