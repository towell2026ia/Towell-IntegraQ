import { createHash } from "node:crypto";

export function createFingerprint(value: unknown) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

export function sanitizeAuditMetadata(value: Record<string, unknown>) {
  return sanitizeRecord(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(api[-_]?key|authorization|cookie|password|secret|token|credential|prompt)/i.test(key)) continue;
    if (Array.isArray(item)) result[key] = item.map((entry) => entry && typeof entry === "object" ? sanitizeRecord(entry as Record<string, unknown>) : entry);
    else if (item && typeof item === "object") result[key] = sanitizeRecord(item as Record<string, unknown>);
    else result[key] = item;
  }
  return result;
}

