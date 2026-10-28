import { canAccessModule } from "./access-policy";
import {
  activeCertifications,
  customerQualityCatalog,
  externalAuditCalendar,
  supplierAuditSemesters,
  supplierPortalAuditResults,
  supplierPortalPlans,
  supplierPortalRncpRecords,
  supplierQualityCatalog,
} from "@/lib/quality-parties-data";
import type { ActiveSession, ExternalPartyKind } from "@/lib/session-data";
import { isAdministrator } from "@/lib/session-data";
import type { CorrectiveAction } from "@/lib/types";

export interface PortalCompany {
  companyId: string;
  companyName: string;
  siteId?: string;
  siteName?: string;
  demo?: boolean;
}

const DEMO_PREVIEW_COMPANY: Record<ExternalPartyKind, string> = {
  customer: "customer-001",
  supplier: "supplier-022",
};

export function resolvePortalCompany(
  session: ActiveSession,
  kind: ExternalPartyKind,
): PortalCompany | null {
  if (!canAccessModule(session, kind === "customer" ? "customer-portal" : "supplier-portal")) return null;
  if (session.workspaceMode !== "demo") {
    const type = kind === "customer" ? "Cliente" : "Proveedor";
    return session.userType === type && session.externalParty?.kind === kind ? { ...session.externalParty } : null;
  }
  const catalog =
    kind === "customer" ? customerQualityCatalog : supplierQualityCatalog;
  const matchingExternalType =
    (kind === "customer" && session.userType === "Cliente") ||
    (kind === "supplier" && session.userType === "Proveedor");
  const companyId = isAdministrator(session)
    ? DEMO_PREVIEW_COMPANY[kind]
    : matchingExternalType && session.externalParty?.kind === kind
      ? session.externalParty.companyId
      : null;

  if (!companyId) return null;
  const company = catalog.find((item) => item.id === companyId);
  if (company) return { companyId: company.id, companyName: company.name, demo: true };
  return matchingExternalType && session.externalParty
    ? {
        companyId: session.externalParty.companyId,
        companyName: session.externalParty.companyName,
        demo: true,
        siteId: session.externalParty.siteId,
        siteName: session.externalParty.siteName,
      }
    : null;
}

export interface CustomerPortalData {
  actions: CorrectiveAction[];
  audits: { id: string; date: string; scope: string; status: string; companyId: string }[];
  certifications: { name: string; certificate: string; validUntil: string; fileId?: string }[];
}
export function getCustomerPortalData(
  companyId: string,
  actions: CorrectiveAction[],
  demo = false,
): CustomerPortalData {
  return {
    actions: (demo ? actions : []).filter(
      (action) =>
        action.source === "customer" && action.relatedPartyId === companyId,
    ),
    audits: (demo ? externalAuditCalendar : []).filter(
      (audit) => audit.companyId === companyId,
    ),
    certifications: (demo ? activeCertifications : []).filter((certification) =>
      certification.sharedWithCompanyIds.includes(companyId),
    ),
  };
}

export function getSupplierPortalData(companyId: string) {
  return {
    supplier: supplierQualityCatalog.find((item) => item.id === companyId) ?? null,
    rncp: supplierPortalRncpRecords.filter(
      (record) => record.companyId === companyId,
    ),
    audits: supplierPortalAuditResults.filter(
      (record) => record.companyId === companyId,
    ),
    calendar: supplierAuditSemesters
      .flatMap((semester) => semester.events)
      .filter((event) => event.supplierId === companyId),
    plans: supplierPortalPlans.filter(
      (record) => record.companyId === companyId,
    ),
  };
}
