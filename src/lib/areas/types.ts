export interface OrganizationArea {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description?: string;
  ownerUserId?: string;
  status: "active" | "inactive";
}

