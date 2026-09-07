export function normalizePositionName(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("es-MX");
}

