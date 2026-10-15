import historical from "./risk-demo-fingerprint.json" with {type:"json"};
export const canonicalRiskValue = value => JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b))):v);
export function classifyRisk(risk) {
  if(risk.id===historical.id) return canonicalRiskValue(risk)===canonicalRiskValue(historical)
    ? {classification:"EXPLICIT_DEMO_TEST",evidence:"Exact historical demonstration fingerprint, all material fields unchanged"}
    : {classification:"AMBIGUOUS",evidence:"Historical demo id materially changed; preserve and review"};
  if(/demo|demostraci[oó]n|prueba|test/iu.test(risk.source)) return {classification:"EXPLICIT_DEMO_TEST",evidence:`Explicit source: ${risk.source}`};
  if(risk.metadata?.generated_for_demonstration===true) return {classification:"EXPLICIT_DEMO_TEST",evidence:"Explicit generated_for_demonstration metadata"};
  if(/^(Matriz 2025 ISO!|Captura manual$)/u.test(risk.source))return {classification:"REAL",evidence:`Declared operational source: ${risk.source}`};
  return {classification:"AMBIGUOUS",evidence:"No unequivocal demonstration evidence"};
}
