import type { SupplierContactEntry, SupplierContacts } from "./model";

export const supplierEmailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const idPattern = /^(?:legacy-primary|legacy-alternate|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function visibleSupplierContacts(value: Partial<SupplierContacts>, includeWithoutEmail = false): SupplierContactEntry[] {
  const entries: SupplierContactEntry[] = Array.isArray(value.contacts) ? [...value.contacts] : [];
  function addLegacy(id: string, name: string, email: string, phone: string, purpose: string) {
    if (!email && !(includeWithoutEmail && (name || phone))) return;
    if (entries.some(item => item.id === id || (email
      ? item.email?.trim().toLowerCase() === email.toLowerCase()
      : name && item.name?.trim().toLowerCase() === name.toLowerCase()))) return;
    const contact = { id, name, email, phone, purpose, position: "", notifyRncp: false };
    if (id === "legacy-primary") entries.unshift(contact);
    else entries.push(contact);
  }
  const qualityName = value.qualityName?.trim() || "";
  const primaryName = value.notificationName?.trim() || qualityName;
  addLegacy("legacy-primary", primaryName, value.email?.trim() || "", value.phone?.trim() || "", "Notificaciones RNCP");
  addLegacy("legacy-alternate", value.alternateName?.trim() || "", value.alternateEmail?.trim() || "", value.alternatePhone?.trim() || "", "Contacto alterno");
  if (includeWithoutEmail && qualityName && qualityName !== primaryName) {
    addLegacy("legacy-quality", qualityName, "", "", "Calidad");
  }
  return entries;
}

export function validateSupplierContacts(input: unknown): SupplierContactEntry[] {
  if (!Array.isArray(input)) throw new Error("La lista de contactos no es válida.");
  const ids = new Set<string>(), emails = new Set<string>();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Contacto ${index + 1}: datos no válidos.`);
    const item = raw as Record<string, unknown>;
    for (const key of ["id", "name", "position", "email", "phone", "purpose"]) if (typeof item[key] !== "string" || (item[key] as string).length > 500) throw new Error(`Contacto ${index + 1}: revisa ${key}.`);
    if (!idPattern.test(item.id as string) || ids.has(item.id as string)) throw new Error(`Contacto ${index + 1}: identificador repetido o no válido.`);
    const name = (item.name as string).trim(), email = (item.email as string).trim().toLowerCase();
    if (!name || !supplierEmailPattern.test(email)) throw new Error(`Contacto ${index + 1}: nombre y correo válido son obligatorios.`);
    if (emails.has(email)) throw new Error(`El correo ${email} aparece más de una vez.`);
    if (typeof item.notifyRncp !== "boolean") throw new Error(`Contacto ${index + 1}: selecciona correctamente el propósito de notificación.`);
    if (item.retired !== undefined && typeof item.retired !== "boolean" || item.retired && item.notifyRncp) throw new Error("Un contacto retirado no puede seleccionarse para notificaciones.");
    ids.add(item.id as string); emails.add(email);
    return { id: item.id as string, name, position: (item.position as string).trim(), email, phone: (item.phone as string).trim(), purpose: (item.purpose as string).trim(), notifyRncp: item.notifyRncp, ...(item.retired ? { retired: true } : {}) };
  });
}
