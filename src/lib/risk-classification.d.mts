import type {RiskRecord} from "./risk-opportunity-data";
export function canonicalRiskValue(value:unknown):string;
export function classifyRisk(risk:RiskRecord):{classification:"REAL"|"EXPLICIT_DEMO_TEST"|"AMBIGUOUS";evidence:string};
