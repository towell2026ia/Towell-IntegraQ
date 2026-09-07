export interface MasterProcess {
  id: string;
  organizationId: string;
  areaId?: string;
  parentProcessId?: string;
  code: string;
  name: string;
  description?: string;
  processOwnerUserId?: string;
  status: "active" | "inactive";
}

