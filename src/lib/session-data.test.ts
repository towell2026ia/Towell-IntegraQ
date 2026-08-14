import { describe, expect, it } from "vitest";

import { activeSession } from "./session-data";

describe("active session", () => {
  it("identifies the user, position and company shown in the workspace", () => {
    expect(activeSession.name).toBe("Francisco Javier Hernández Retana");
    expect(activeSession.position).toBe("Gerente de Calidad");
    expect(activeSession.department).toBe("Calidad");
    expect(activeSession.company).toBe("Towell");
    expect(activeSession.userType).toBe("Administrador");
    expect(activeSession.assignedProcessIds).toContain("P-08");
  });
});
