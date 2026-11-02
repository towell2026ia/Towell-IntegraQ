import { describe, expect, it } from "vitest";

import {
  canEditCorrectiveAction,
  canViewCorrectiveAction,
} from "@/lib/corrective-action-access";
import type { ActiveSession } from "@/lib/session-data";
import type { CorrectiveAction } from "@/lib/types";

const session: ActiveSession = {
  userId: "USR-TEJIDO",
  authUserId: "0e7192ec-8f68-4bb4-bbe0-cb45ad8ddd97",
  organizationId: "org-a",
  workspaceMode: "production",
  name: "Supervisor de Tejido",
  shortName: "Supervisor",
  initials: "ST",
  position: "Supervisor",
  department: "Tejido",
  company: "Towell",
  userType: "Usuario interno",
  assignedProcessIds: ["P-13", "P-14", "P-15"],
  assignedModuleIds: ["corrective-actions"],
  moduleActionPermissions: [{ moduleId: "corrective-actions", action: "view" }],
};

const action: CorrectiveAction = {
  id: "AC-1",
  organizationId: "org-a",
  processId: "P-13",
  folio: "AC-2026-001",
  title: "Tensión de urdido",
  problem: "Variación detectada",
  source: "internal",
  severity: "medium",
  area: "Tejido",
  owner: "Jefe de Tejido",
  createdAt: "2026-08-20",
  dueDate: "2026-09-20",
  status: "analysis",
  progress: 30,
  evidenceCount: 0,
  participantUserIds: [],
};

describe("corrective action consultation", () => {
  it("shows authorized organization and process records without participation", () => {
    expect(canViewCorrectiveAction(session, action)).toBe(true);
    expect(canViewCorrectiveAction(session, { ...action, processId: undefined })).toBe(true);
    expect(canViewCorrectiveAction(session, { ...action, processId: "P-99" })).toBe(false);
    expect(canViewCorrectiveAction(session, { ...action, organizationId: "org-b" })).toBe(false);
    expect(canViewCorrectiveAction({ ...session, assignedModuleIds: [], moduleActionPermissions: [] }, action)).toBe(false);
    expect(canViewCorrectiveAction({ ...session, userType: "Cliente" }, action)).toBe(false);
  });

  it("keeps internal viewers read-only even with a historical update grant", () => {
    expect(canEditCorrectiveAction(session, action)).toBe(false);
    expect(canEditCorrectiveAction({
      ...session,
      moduleActionPermissions: [
        { moduleId: "corrective-actions", action: "view" },
        { moduleId: "corrective-actions", action: "update" },
      ],
    }, action)).toBe(false);
    expect(canEditCorrectiveAction({ ...session, userType: "Administrador" }, action)).toBe(true);
  });
});
