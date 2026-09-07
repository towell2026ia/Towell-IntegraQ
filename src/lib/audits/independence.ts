export interface AuditorAssignment {
  auditorId: string;
  auditorProcessIds: string[];
  auditorAreaId?: string;
  auditedProcessIds: string[];
  auditedAreaIds?: string[];
  override?: { authorizedBy: string; justification: string };
}

export function validateAuditorIndependence(input: AuditorAssignment) {
  const processConflict = input.auditedProcessIds.some((processId) => input.auditorProcessIds.includes(processId));
  const areaConflict = Boolean(input.auditorAreaId && input.auditedAreaIds?.includes(input.auditorAreaId));
  if (!processConflict && !areaConflict) return { valid: true, overrideRequired: false };
  const validOverride = Boolean(input.override?.authorizedBy && input.override.justification.trim().length >= 10 && input.override.authorizedBy !== input.auditorId);
  return { valid: validOverride, overrideRequired: true, reason: validOverride ? null : "CONFLICT_OF_INTEREST" };
}
