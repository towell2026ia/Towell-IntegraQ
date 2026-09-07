export const activityOrigins = ["human", "system", "import", "migration", "integration", "ai", "admin_override"] as const;
export type ActivityOrigin = typeof activityOrigins[number];

export interface ActivityEvent {
  id: string;
  organizationId?: string;
  userId?: string;
  userNameSnapshot: string;
  module: string;
  entityType: string;
  entityId?: string;
  entityCodeSnapshot?: string;
  action: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
  origin: ActivityOrigin;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}
