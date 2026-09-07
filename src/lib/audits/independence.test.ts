import { describe, expect, it } from "vitest";

import { validateAuditorIndependence } from "./independence";

describe("auditor independence", () => {
  it("accepts an independent auditor", () => {
    expect(validateAuditorIndependence({ auditorId: "a1", auditorProcessIds: ["P-08"], auditedProcessIds: ["P-17"] })).toEqual({ valid: true, overrideRequired: false });
  });

  it("requires a documented and independently authorized exception", () => {
    expect(validateAuditorIndependence({ auditorId: "a1", auditorProcessIds: ["P-08"], auditedProcessIds: ["P-08"] })).toMatchObject({ valid: false, reason: "CONFLICT_OF_INTEREST" });
    expect(validateAuditorIndependence({ auditorId: "a1", auditorProcessIds: ["P-08"], auditedProcessIds: ["P-08"], override: { authorizedBy: "lead", justification: "No existe auditor independiente disponible." } })).toMatchObject({ valid: true, overrideRequired: true });
  });
});
