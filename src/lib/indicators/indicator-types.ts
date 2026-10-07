import type {
  ConfiguredIndicator,
  IndicatorResultRecord,
  IndicatorResults,
  Quarter,
} from "@/lib/indicator-data";

export interface IndicatorRuntimeSnapshot {
  definitions: ConfiguredIndicator[];
  results: IndicatorResults;
  access: IndicatorRuntimeAccess;
  settings: IndicatorRuntimeSettings;
  loadedAt: string;
  source: "supabase";
}

export interface IndicatorRuntimeAccess {
  administrator: boolean;
  assignedProcessIds: string[];
  canUpdate: boolean;
  canView: boolean;
}

export interface IndicatorRuntimeSettings {
  captureDaysAfterClose: number;
  timezone: "America/Mexico_City";
}

export interface IndicatorResultInput {
  indicatorId: string;
  year: number;
  quarter: Quarter;
  value: number;
  comments: string;
  evidenceFileId?: string;
  adminOverrideReason?: string;
}

export interface IndicatorResultConfirmation {
  indicatorId: string;
  year: number;
  quarter: Quarter;
  record: IndicatorResultRecord;
}
