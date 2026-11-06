import type { ControlledDocumentVersion } from "./document-control-data";

export type DocumentReplacementKind = "version" | "revision";

/** Historical `revision` remains unchanged. Explicit numbering applies only to new rows. */
export function documentVersionLabel(version?: ControlledDocumentVersion) {
  if (!version) return "—";
  if (version.versionNumber != null) {
    return `Versión ${version.versionNumber}${version.revisionSequence ? ` · revisión ${version.revisionSequence}` : ""}`;
  }
  if (version.legacyRevision != null) {
    return `Rev. histórica ${version.legacyRevision} · revisión ${version.revisionSequence ?? 0}`;
  }
  return `Rev. histórica ${version.revision}`;
}

export function nextDocumentNumbering(versions: ControlledDocumentVersion[], kind: DocumentReplacementKind) {
  const latest = versions.find(v => v.status === "current") ?? [...versions].sort((a, b) => b.revision - a.revision)[0];
  const technicalRevision = Math.max(-1, ...versions.map(v => v.revision)) + 1;
  if (!latest) return { revision: technicalRevision, versionNumber: 0, revisionSequence: 0, legacyRevision: undefined };
  if (kind === "version") {
    const floor = Math.max(...versions.map(v => v.versionNumber ?? v.legacyRevision ?? v.revision));
    return { revision: technicalRevision, versionNumber: floor + 1, revisionSequence: 0, legacyRevision: undefined };
  }
  return {
    revision: technicalRevision,
    versionNumber: latest.versionNumber,
    revisionSequence: (latest.revisionSequence ?? 0) + 1,
    legacyRevision: latest.versionNumber == null ? latest.legacyRevision ?? latest.revision : undefined,
  };
}
