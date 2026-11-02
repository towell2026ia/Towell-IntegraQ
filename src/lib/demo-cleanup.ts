/** Only an unchanged built-in sample can be removed automatically. */
export function withoutUnchangedSamples<T extends { id: string }>(saved: T[], samples: T[], generatedKeys: string[] = []): T[] {
  const byId = new Map<string, T[]>();
  for (const sample of samples) byId.set(sample.id, [...(byId.get(sample.id) ?? []), sample]);
  const comparable = (value: T) => JSON.stringify(value, (key, entry: unknown) => generatedKeys.includes(key) ? undefined : entry);
  return saved.filter(item => {
    const variants = byId.get(item.id);
    return !variants?.some(sample => comparable(item) === comparable(sample));
  });
}
