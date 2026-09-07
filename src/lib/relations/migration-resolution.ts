export interface MigrationCandidate {
  id: string;
  name: string;
}

export type MigrationResolution =
  | { status: "matched"; candidate: MigrationCandidate }
  | { status: "ambiguous"; candidates: MigrationCandidate[] }
  | { status: "unmatched"; candidates: [] };

export function normalizeRelationshipText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-MX");
}

export function resolveMigrationRelationship(value: string, candidates: MigrationCandidate[]): MigrationResolution {
  const normalized = normalizeRelationshipText(value);
  const matches = candidates.filter((candidate) => normalizeRelationshipText(candidate.name) === normalized);
  if (matches.length === 1) return { status: "matched", candidate: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches };
  return { status: "unmatched", candidates: [] };
}

