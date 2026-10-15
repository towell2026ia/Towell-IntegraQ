import {describe,it,expect} from "vitest";
import {buildInitialRiskWorkspace,buildDemoRiskWorkspace,buildProductionRiskWorkspace,normalizeRiskWorkspace,operationalRiskWorkspace} from "./risk-opportunity-data";
import {classifyRisk,riskEvents,validateRiskHistory} from "./risk-lifecycle";

describe("risk lifecycle and productive isolation",()=>{
  it("never seeds production, including malformed and missing stored arrays",()=>{
    expect(buildProductionRiskWorkspace().risks).toEqual([]);
    expect(buildInitialRiskWorkspace().risks).toEqual([]);
    expect(normalizeRiskWorkspace(null).risks).toEqual([]);
    expect(normalizeRiskWorkspace({cycle:2026}).actions).toEqual([]);
    expect(normalizeRiskWorkspace({directionCandidates:[]}).directionCandidates).toEqual([]);
  });
  it("classifies only the unchanged historical demonstration",()=>{
    const seed=buildDemoRiskWorkspace().risks[1];
    expect(classifyRisk(seed).classification).toBe("EXPLICIT_DEMO_TEST");
    expect(classifyRisk({...seed,title:"Material operational change"}).classification).toBe("AMBIGUOUS");
    expect(classifyRisk({...seed,source:"Captura manual"}).classification).toBe("AMBIGUOUS");
    expect(classifyRisk({...seed,id:"new",source:"Registro de prueba"}).classification).toBe("EXPLICIT_DEMO_TEST");
  });
  it("preserves both historical matrix records and ambiguous entries",()=>{
    const state=buildDemoRiskWorkspace();
    expect(classifyRisk(state.risks[0]).classification).toBe("REAL");
    expect(classifyRisk(state.risks[2]).classification).toBe("REAL");
    expect(classifyRisk({...state.risks[0],source:"Origen desconocido"}).classification).toBe("AMBIGUOUS");
  });
  it("rejects physical removal, forged tombstones and action history loss",()=>{
    const state=buildDemoRiskWorkspace();
    expect(()=>validateRiskHistory(state,{...state,risks:state.risks.slice(1)})).toThrow();
    expect(()=>validateRiskHistory(state,{...state,risks:state.risks.map(r=>({...r,deletedAt:"2026-01-01"}))})).toThrow();
    expect(()=>validateRiskHistory(state,{...state,actions:[]})).toThrow();
    const tombstone={...state,risks:state.risks.map(r=>({...r,deletedAt:"2026-01-01"}))};
    expect(()=>validateRiskHistory(tombstone,{...tombstone,risks:tombstone.risks.map(r=>({...r,title:"tamper"}))})).toThrow();
  });
  it("hides tombstones and associated actions without losing historical state or generating alerts",()=>{
    const state=buildDemoRiskWorkspace();state.risks[1].deletedAt="2026-01-01";
    const operational=operationalRiskWorkspace(state);
    expect(operational.risks).toHaveLength(2);
    expect(operational.actions.some(a=>a.id==="ACT-RYO-002")).toBe(false);
    expect(state.actions).toHaveLength(3);
    expect(riskEvents(state,state).some(e=>e.resourceId==="ACT-RYO-002")).toBe(false);
  });
  it("emits creation, assignment, critical and stable deadline identities",()=>{
    const next=buildDemoRiskWorkspace();
    const events=riskEvents(buildProductionRiskWorkspace(),next,new Date("2026-10-15"));
    expect(events.filter(e=>e.type==="risk.created")).toHaveLength(3);
    expect(events.filter(e=>e.type==="risk.action_assigned")).toHaveLength(3);
    const unchanged=riskEvents(next,next,new Date("2026-10-16"));
    expect(unchanged.some(e=>e.type==="risk.updated")).toBe(false);
    expect(unchanged.find(e=>e.type==="risk.action_overdue")?.occurrence).toBe("2025-04-15");
  });
});
