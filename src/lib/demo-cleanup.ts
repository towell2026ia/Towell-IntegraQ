/** Only an unchanged built-in sample can be removed automatically. */
export function withoutUnchangedSamples<T extends { id: string }>(saved: T[], samples: T[], generatedKeys: string[] = []): T[] {
  const byId = new Map<string, T[]>();
  for (const sample of samples) byId.set(sample.id, [...(byId.get(sample.id) ?? []), sample]);
  const ignored = new Set(generatedKeys);
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value)
        .filter(([key, entry]) => !ignored.has(key) && entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
    }
    return value;
  };
  const comparable = (value: T) => JSON.stringify(canonical(value));
  return saved.filter(item => {
    const variants = byId.get(item.id);
    return !variants?.some(sample => comparable(item) === comparable(sample));
  });
}
