import { describe, expect, it } from "vitest";

import { validateExternalCompanyDeactivation } from "@/lib/external-company-data";

describe("desactivación administrativa de empresas externas", () => {
  it("requiere motivo cuando se desactiva una empresa", () => {
    expect(validateExternalCompanyDeactivation(false, "Retiro solicitado por administración")).toBe(true);
    expect(validateExternalCompanyDeactivation(false, "  ")).toBe(false);
    expect(validateExternalCompanyDeactivation(false, undefined)).toBe(false);
  });

  it("no exige motivo para conservar una empresa activa", () => {
    expect(validateExternalCompanyDeactivation(true, undefined)).toBe(true);
    expect(validateExternalCompanyDeactivation(undefined, undefined)).toBe(true);
  });
});
