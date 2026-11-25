import { describe, expect, it } from "vitest";
import { validateSupplierContacts, visibleSupplierContacts } from "./contacts";

const first = { id: "legacy-primary", name: "Calidad", position: "Inspectora", email: "calidad@example.test", phone: "123", purpose: "RNCP", notifyRncp: true };
const second = { id: "legacy-alternate", name: "Compras", position: "", email: "compras@example.test", phone: "456", purpose: "Alterno", notifyRncp: false };

describe("multiple supplier contacts", () => {
  it("keeps retired contacts identifiable and excludes them from active RNCP selection", () => {
    expect(validateSupplierContacts([{ ...first, retired: true, notifyRncp: false }])[0]).toMatchObject({ id: first.id, retired: true, notifyRncp: false });
    expect(() => validateSupplierContacts([{ ...first, retired: true, notifyRncp: true }])).toThrow(/retirado/);
  });
  it("presents both historical addresses without changing the source object", () => {
    const historical = { qualityName: "Calidad", notificationName: "Calidad", email: first.email, phone: first.phone, alternateName: second.name, alternateEmail: second.email, alternatePhone: second.phone };
    expect(visibleSupplierContacts(historical).map(entry => entry.id)).toEqual(["legacy-primary", "legacy-alternate"]);
    expect(historical).not.toHaveProperty("contacts");
  });
  it("keeps a historical address visible when a partial collection already exists", () => {
    expect(visibleSupplierContacts({ email: first.email, contacts: [second] }).map(entry => entry.email)).toEqual([first.email, second.email]);
  });
  it("accepts a variable number and normalizes individual addresses", () => {
    const entries = [first, second, { ...second, id: "e274fa8c-40e6-4fcf-8bf9-2532d55dfbaa", email: " Third@Example.test " }];
    expect(validateSupplierContacts(entries).map(entry => entry.email)).toEqual(["calidad@example.test", "compras@example.test", "third@example.test"]);
  });
  it("rejects duplicate addresses and identifiers", () => {
    expect(() => validateSupplierContacts([first, { ...second, email: " CALIDAD@example.test " }])).toThrow(/más de una vez/);
    expect(() => validateSupplierContacts([first, { ...second, id: first.id }])).toThrow(/identificador repetido/);
  });
  it("requires a named contact, valid email and explicit notification selection", () => {
    expect(() => validateSupplierContacts([{ ...first, name: "" }])).toThrow(/nombre y correo/);
    expect(() => validateSupplierContacts([{ ...first, email: "bad" }])).toThrow(/nombre y correo/);
    expect(() => validateSupplierContacts([{ ...first, notifyRncp: "true" }])).toThrow(/propósito/);
  });
});
