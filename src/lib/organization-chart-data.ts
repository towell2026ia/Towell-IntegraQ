export interface DetectedOrganizationPosition {
  clientId: string;
  name: string;
  level: number;
  branch: string;
  parentName?: string;
}

export interface OrganizationChartDraft {
  sourceName: string;
  positions: DetectedOrganizationPosition[];
  confidence: number;
  warnings: string[];
}

const positionWords = /\b(direcci[oó]n|director(?:a)?|gerencia|gerente|jefatura|jefe|coordinaci[oó]n|coordinador(?:a)?|supervisor(?:a)?|auditor(?:a)?|t[eé]cnico|analista|encargad[oa]|auxiliar|operador(?:a)?|inspector(?:a)?|promotor(?:a)?|ejecutiv[oa]|responsable|l[ií]der)\b/i;

export function interpretOrganizationGrid({
  sourceName,
  processName,
  grid,
}: {
  sourceName: string;
  processName: string;
  grid: string[][];
}): OrganizationChartDraft {
  const normalizedGrid = grid.map((row) => row.map(normalizeText));
  const header = findHeader(normalizedGrid);
  const positions = header
    ? interpretTabularRows(normalizedGrid, header, processName)
    : interpretVisualCells(normalizedGrid, processName);
  const hasExplicitHierarchy = Boolean(header?.levelIndex !== undefined || header?.parentIndex !== undefined);

  return {
    sourceName,
    positions,
    confidence: positions.length
      ? Math.min(0.96, 0.52 + positions.length * 0.025 + (hasExplicitHierarchy ? 0.18 : 0))
      : 0.2,
    warnings: [
      hasExplicitHierarchy
        ? "La jerarquía se leyó desde las columnas de nivel y dependencia."
        : "La jerarquía se infirió por el nombre de los puestos; confirma cada dependencia antes de integrar.",
      ...(positions.some((position) => position.level > 4)
        ? []
        : ["No se detectaron puestos debajo del nivel 4; puedes agregarlos manualmente en la revisión."]),
    ],
  };
}

export function normalizeOrganizationChartDraft(
  value: unknown,
  sourceName: string,
  processName: string,
): OrganizationChartDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<OrganizationChartDraft>;
  if (!Array.isArray(candidate.positions)) return null;
  const positions = candidate.positions
    .map((position, index) => normalizePosition(position, index, processName))
    .filter((position): position is DetectedOrganizationPosition => Boolean(position));
  return {
    sourceName,
    positions: uniquePositions(positions),
    confidence: typeof candidate.confidence === "number"
      ? Math.max(0, Math.min(1, candidate.confidence))
      : positions.length ? 0.75 : 0,
    warnings: Array.isArray(candidate.warnings)
      ? candidate.warnings.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function computeHierarchyLevels<T extends { id: string; parentId?: string; level: number }>(positions: T[]) {
  const byId = new Map(positions.map((position) => [position.id, position]));
  const cache = new Map<string, number>();
  const calculate = (position: T, trail = new Set<string>()): number => {
    if (cache.has(position.id)) return cache.get(position.id)!;
    if (!position.parentId || trail.has(position.id)) return Math.max(1, position.level);
    const parent = byId.get(position.parentId);
    if (!parent) return Math.max(1, position.level);
    const nextTrail = new Set(trail).add(position.id);
    const level = calculate(parent, nextTrail) + 1;
    cache.set(position.id, level);
    return level;
  };
  return positions.map((position) => ({ ...position, level: calculate(position) }));
}

function findHeader(grid: string[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(grid.length, 30); rowIndex += 1) {
    const row = grid[rowIndex];
    const nameIndex = row.findIndex((value) => /^(puesto|cargo|nombre del puesto|posici[oó]n)$/i.test(value));
    if (nameIndex < 0) continue;
    const levelIndex = row.findIndex((value) => /^(nivel|nivel jer[aá]rquico)$/i.test(value));
    const parentIndex = row.findIndex((value) => /^(reporta a|depende de|jefe inmediato|superior)$/i.test(value));
    const branchIndex = row.findIndex((value) => /^(area|[aá]rea|departamento|rama|proceso)$/i.test(value));
    return {
      rowIndex,
      nameIndex,
      ...(levelIndex >= 0 ? { levelIndex } : {}),
      ...(parentIndex >= 0 ? { parentIndex } : {}),
      ...(branchIndex >= 0 ? { branchIndex } : {}),
    };
  }
  return null;
}

function interpretTabularRows(
  grid: string[][],
  header: NonNullable<ReturnType<typeof findHeader>>,
  processName: string,
) {
  const stack = new Map<number, string>();
  const positions: DetectedOrganizationPosition[] = [];
  for (const row of grid.slice(header.rowIndex + 1)) {
    const name = normalizeText(row[header.nameIndex]);
    if (!isPositionName(name)) continue;
    const level = parseLevel(header.levelIndex === undefined ? "" : row[header.levelIndex]) || inferLevelFromName(name);
    const explicitParent = header.parentIndex === undefined ? "" : normalizeText(row[header.parentIndex]);
    const parentName = explicitParent || findClosestParent(stack, level);
    positions.push({
      clientId: `detected-${positions.length + 1}`,
      name,
      level,
      branch: normalizeText(header.branchIndex === undefined ? "" : row[header.branchIndex]) || processName,
      ...(parentName ? { parentName } : {}),
    });
    stack.set(level, name);
    for (const key of [...stack.keys()]) if (key > level) stack.delete(key);
  }
  return uniquePositions(positions);
}

function interpretVisualCells(grid: string[][], processName: string) {
  const stack = new Map<number, string>();
  const positions: DetectedOrganizationPosition[] = [];
  for (const row of grid) {
    const values = row.filter(isPositionName);
    for (const name of values) {
      const level = inferLevelFromName(name);
      const parentName = findClosestParent(stack, level);
      positions.push({
        clientId: `detected-${positions.length + 1}`,
        name,
        level,
        branch: processName,
        ...(parentName ? { parentName } : {}),
      });
      stack.set(level, name);
      for (const key of [...stack.keys()]) if (key > level) stack.delete(key);
    }
  }
  return uniquePositions(positions);
}

function normalizePosition(value: unknown, index: number, processName: string) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DetectedOrganizationPosition>;
  const name = typeof candidate.name === "string" ? normalizeText(candidate.name) : "";
  if (!name) return null;
  const level = typeof candidate.level === "number" && Number.isFinite(candidate.level)
    ? Math.max(1, Math.min(12, Math.round(candidate.level)))
    : inferLevelFromName(name);
  return {
    clientId: typeof candidate.clientId === "string" && candidate.clientId.trim()
      ? candidate.clientId.trim()
      : `detected-${index + 1}`,
    name,
    level,
    branch: typeof candidate.branch === "string" && candidate.branch.trim()
      ? normalizeText(candidate.branch)
      : processName,
    ...(typeof candidate.parentName === "string" && candidate.parentName.trim()
      ? { parentName: normalizeText(candidate.parentName) }
      : {}),
  } satisfies DetectedOrganizationPosition;
}

function uniquePositions(positions: DetectedOrganizationPosition[]) {
  const seen = new Set<string>();
  return positions.filter((position) => {
    const key = position.name.toLocaleLowerCase("es-MX");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferLevelFromName(name: string) {
  if (/direcci[oó]n general/i.test(name)) return 1;
  if (/\b(direcci[oó]n|director(?:a)?)\b/i.test(name)) return 2;
  if (/\b(gerencia|gerente)\b/i.test(name)) return 3;
  if (/\b(jefatura|jefe|coordinaci[oó]n|coordinador(?:a)?)\b/i.test(name)) return 4;
  return 5;
}

function parseLevel(value: string) {
  const match = normalizeText(value).match(/\d{1,2}/);
  return match ? Math.max(1, Math.min(12, Number(match[0]))) : 0;
}

function findClosestParent(stack: Map<number, string>, level: number) {
  for (let candidateLevel = level - 1; candidateLevel >= 1; candidateLevel -= 1) {
    const parent = stack.get(candidateLevel);
    if (parent) return parent;
  }
  return undefined;
}

function isPositionName(value: string) {
  const normalized = normalizeText(value);
  return normalized.length >= 4 && normalized.length <= 100 && positionWords.test(normalized);
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
