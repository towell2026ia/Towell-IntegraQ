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
}

const ADMIN_PREVIEW_COMPANY: Record<ExternalPartyKind, string> = {
  customer: "customer-001",
  supplier: "supplier-022",
};

export function resolvePortalCompany(
  session: ActiveSession,
  kind: ExternalPartyKind,
): PortalCompany | null {
  const catalog =
    kind === "customer" ? customerQualityCatalog : supplierQualityCatalog;
  const matchingExternalType =
    (kind === "customer" && session.userType === "Cliente") ||
    (kind === "supplier" && session.userType === "Proveedor");
  const companyId = isAdministrator(session)
    ? ADMIN_PREVIEW_COMPANY[kind]
    : matchingExternalType && session.externalParty?.kind === kind
      ? session.externalParty.companyId
      : null;

  if (!companyId) return null;
  const company = catalog.find((item) => item.id === companyId);
  return company
    ? { companyId: company.id, companyName: company.name }
    : null;
}

export function getCustomerPortalData(
  companyId: string,
  actions: CorrectiveAction[],
) {
  return {
    actions: actions.filter(
      (action) =>
        action.source === "customer" && action.relatedPartyId === companyId,
    ),
    audits: externalAuditCalendar.filter(
      (audit) => audit.companyId === companyId,
    ),
    certifications: activeCertifications.filter((certification) =>
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
