import { describe, expect, it } from "vitest";

import {
  buildFolderBreadcrumb,
  canDownloadGeneralInformation,
  canManageGeneralInformation,
  canViewGeneralInformation,
  isDescendantFolder,
  validateGeneralInformationFile,
  validateGeneralInformationMetadata,
} from "@/lib/general-information";
import type { ActiveSession } from "@/lib/session-data";

const user: ActiveSession = {
  userId: "user-1",
  name: "Usuario",
  shortName: "Usuario",
  initials: "U",
  position: "Consulta",
  department: "Calidad",
  company: "Towell",
  userType: "Usuario interno",
  assignedProcessIds: [],
};

describe("general information policy", () => {
  it("allows every authenticated session to view without a module permission", () => {
    expect(canViewGeneralInformation(user)).toBe(true);
    expect(canViewGeneralInformation({ ...user, userType: "Cliente" })).toBe(true);
    expect(canViewGeneralInformation({ ...user, userType: "Proveedor" })).toBe(true);
    expect(canViewGeneralInformation(null)).toBe(false);
  });

  it("reserves administration and downloads for administrators", () => {
    expect(canManageGeneralInformation(user)).toBe(false);
    expect(canDownloadGeneralInformation(user)).toBe(false);
    expect(canManageGeneralInformation({ ...user, userType: "Administrador" })).toBe(true);
    expect(canDownloadGeneralInformation({ ...user, userType: "Administrador" })).toBe(true);
  });

  it("builds unlimited breadcrumbs and detects descendants", () => {
    const folders = [
      { id: "a", workspaceId: "w", name: "Calidad", createdAt: "", updatedAt: "" },
      { id: "b", workspaceId: "w", name: "Manuales", parentFolderId: "a", createdAt: "", updatedAt: "" },
      { id: "c", workspaceId: "w", name: "Clientes", parentFolderId: "b", createdAt: "", updatedAt: "" },
    ];
    expect(buildFolderBreadcrumb(folders, "c").map((folder) => folder.id)).toEqual(["a", "b", "c"]);
    expect(isDescendantFolder(folders, "c", "a")).toBe(true);
    expect(isDescendantFolder(folders, "a", "c")).toBe(false);
  });

  it("validates metadata dates", () => {
    expect(validateGeneralInformationMetadata({ folderId: "f", name: "Manual", referenceType: "internal", validityStatus: "current" })).toBeNull();
    expect(validateGeneralInformationMetadata({ folderId: "f", name: "Manual", referenceType: "external", validityStatus: "current", validFrom: "2026-09-27", validUntil: "2026-01-01" })).toMatch(/fecha final/i);
  });

  it("accepts supported document formats and rejects unsafe upload shapes", () => {
    expect(validateGeneralInformationFile({ name: "manual.pdf", size: 1024 })).toBeNull();
    expect(validateGeneralInformationFile({ name: "presentacion.pptx", size: 1024 })).toBeNull();
    expect(validateGeneralInformationFile({ name: "script.exe", size: 1024 })).toMatch(/formato/i);
    expect(validateGeneralInformationFile({ name: "vacio.txt", size: 0 })).toMatch(/50 MB/i);
    expect(validateGeneralInformationFile({ name: "enorme.pdf", size: 50 * 1024 * 1024 + 1 })).toMatch(/50 MB/i);
  });
});
