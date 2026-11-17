import type { SupplierContactEntry, SupplierContacts } from "./model";

const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const idPattern = /^(?:legacy-primary|legacy-alternate|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function visibleSupplierContacts(value: Partial<SupplierContacts>): SupplierContactEntry[] {
  const entries: SupplierContactEntry[] = Array.isArray(value.contacts) ? [...value.contacts] : [];
  if (value.email?.trim() && !entries.some(item => item.email?.toLowerCase() === value.email?.trim().toLowerCase())) entries.unshift({ id: "legacy-primary", name: value.notificationName?.trim() || value.qualityName?.trim() || "", position: "", email: value.email.trim(), phone: value.phone?.trim() || "", purpose: "Notificaciones RNCP", notifyRncp: false });
  if (value.alternateEmail?.trim() && !entries.some(item => item.email?.toLowerCase() === value.alternateEmail?.trim().toLowerCase())) entries.push({ id: "legacy-alternate", name: value.alternateName?.trim() || "", position: "", email: value.alternateEmail.trim(), phone: value.alternatePhone?.trim() || "", purpose: "Contacto alterno", notifyRncp: false });
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
    if (!name || !emailPattern.test(email)) throw new Error(`Contacto ${index + 1}: nombre y correo válido son obligatorios.`);
    if (emails.has(email)) throw new Error(`El correo ${email} aparece más de una vez.`);
    if (typeof item.notifyRncp !== "boolean") throw new Error(`Contacto ${index + 1}: selecciona correctamente el propósito de notificación.`);
    ids.add(item.id as string); emails.add(email);
    return { id: item.id as string, name, position: (item.position as string).trim(), email, phone: (item.phone as string).trim(), purpose: (item.purpose as string).trim(), notifyRncp: item.notifyRncp };
  });
}
