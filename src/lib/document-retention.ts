export function relationRecord<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

export async function discardUnpublishedUpload(
  lookup: () => Promise<{ registered: boolean; uncertain: boolean }>,
  remove: () => Promise<unknown>,
) {
  const state = await lookup();
  if (!state.registered && !state.uncertain) await remove();
}
