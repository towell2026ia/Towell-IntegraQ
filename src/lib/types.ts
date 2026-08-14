export type CorrectiveActionStatus =
  | "open"
  | "analysis"
  | "action_plan"
  | "implementation"
  | "effectiveness"
  | "closed";

export type CorrectiveActionSource =
  | "internal"
  | "audit"
  | "customer"
  | "supplier";

export type CorrectiveActionSeverity = "low" | "medium" | "high" | "critical";

export interface A3ActionPlanItem {
  id: string;
  description: string;
  owner: string;
  dueDate: string;
  status: "pending" | "in_progress" | "completed";
}

export interface A3Analysis {
  eventType: string;
  severityJustification: string;
  fiveW2H: {
    what: string;
    why: string;
    where: string;
    when: string;
    who: string;
    how: string;
    howMuch: string;
  };
  brainstorm: string[];
  ishikawa: {
    workforce: string[];
    machinery: string[];
    method: string[];
    material: string[];
    environment: string[];
    measurement: string[];
  };
  nonDetectionCause: string;
  rootCause: string;
  nonDetectionWhys: string[];
  rootCauseWhys: string[];
  plans: A3ActionPlanItem[];
};

export interface AiRootCauseDraft {
  mode: "external" | "demo";
  summary: string;
  fiveWhys: string[];
  probableRootCause: string;
  suggestedActions: string[];
  warnings: string[];
  contextSources?: AiContextSources;
}

export interface AiDocumentReference {
  id: string;
  code: string;
  title: string;
  type: string;
  version?: string;
  excerpt?: string;
}

export interface AiContextSources {
  processId?: string;
  processName?: string;
  parentProcessName?: string;
  documentFamilies: string[];
  documents: AiDocumentReference[];
  a3Sections: string[];
}

export interface CorrectiveAction {
  id: string;
  folio: string;
  title: string;
  problem: string;
  source: CorrectiveActionSource;
  severity: CorrectiveActionSeverity;
  area: string;
  owner: string;
  createdAt: string;
  dueDate: string;
  status: CorrectiveActionStatus;
  progress: number;
  evidenceCount: number;
  rootCause?: string;
  aiDraft?: AiRootCauseDraft;
  relatedParty?: string;
  a3?: A3Analysis;
}

export type MeasurementActivity = "calibration" | "verification" | "both";

export interface MeasurementAsset {
  id: string;
  code: string;
  name: string;
  location: string;
  owner: string;
  activity: MeasurementActivity;
  frequencyMonths: number;
  lastCompletedAt: string;
  nextDueDate: string;
  evidenceCount: number;
  standard: string;
}

export type DueStatus = "current" | "due_soon" | "overdue";

export interface AiRootCauseRequest {
  problem: string;
  context: string;
  source: CorrectiveActionSource;
  contextSources?: AiContextSources;
  analysis?: A3Analysis;
}
