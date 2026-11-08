import { describe, expect, it } from "vitest";
import { parsePdfRncpIdentity, readRncpPdf } from "./pdf";
describe("official RNCP PDF supplier identity", () => {
  it("recognizes a numeric official code only in the labelled supplier field", () => {
    expect(parsePdfRncpIdentity("Folio de RNCP: RNCP0006 Proveedor Procesos Textiles Ejemplo Número de Proveedor 006 Factura 1547", "RNCP0006.pdf")).toEqual({ folio: "RNCP0006", supplierCode: "006", ambiguous: false });
    expect(parsePdfRncpIdentity("RNCP0006 Factura 006", "RNCP0006.pdf").ambiguous).toBe(true);
  });
  it("keeps labelled non-PR codes and rejects conflicting supplier fields", () => {
    expect(parsePdfRncpIdentity("RNCP0006 Número de Proveedor S/N-02", "RNCP0006.pdf").supplierCode).toBe("S/N-02");
    expect(parsePdfRncpIdentity("RNCP0006 Número de Proveedor 006 Número de Proveedor 007", "RNCP0006.pdf").ambiguous).toBe(true);
  });
  it("preserves content versus filename conflict protection and legacy PR codes", () => {
    expect(parsePdfRncpIdentity("RNCP0006 Número de Proveedor 006", "RNCP0007.pdf").ambiguous).toBe(true);
    expect(parsePdfRncpIdentity("RNCP0006 PR00350", "RNCP0006.pdf").ambiguous).toBe(false);
    expect(parsePdfRncpIdentity("Número de Proveedor 006", "RNCP0006.pdf").ambiguous).toBe(true);
  });
});

it("reads the visual supplier field when PDF drawing commands are out of order", async () => {
  const { jsPDF } = await import("jspdf"); const pdf = new jsPDF();
  pdf.text("006", 170, 50); pdf.text("Folio de RNCP: RNCP0006", 10, 20);
  pdf.text("Numero de Proveedor", 95, 50); pdf.text("Proveedor Ejemplo", 10, 50);
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  expect(parsePdfRncpIdentity(await readRncpPdf(bytes), "RNCP0006.pdf")).toEqual({ folio: "RNCP0006", supplierCode: "006", ambiguous: false });
});
