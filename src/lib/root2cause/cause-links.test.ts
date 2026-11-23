import { expect,it } from "vitest";
import { changeCause, removeCause } from "./cause-links";
import { proposalContext,assertProposalContext } from "./assistant";
const seed = { brainstorm:["Tensión"], brainstormIds:["idea"], rootCause:"Tensión", rootCauseCauseId:"cause",
  rootCauseWhys:["Medición"], causeItems:[{id:"cause",text:"Tensión",category:"method" as const,sourceIdeaId:"idea"}],
  plans:[{id:"plan",description:"Medir",owner:"QA",dueDate:"2026-12-01",status:"pending" as const,causeId:"cause",causeCategory:"method" as const}] };
it("keeps identity and linked records through edit, move, declassification and reload",()=>{
  const next=changeCause(seed,"cause",{category:"measurement",text:"Tensión del hilo"});
  expect(next).toMatchObject({rootCause:"Tensión del hilo",rootCauseWhys:["Medición"],brainstorm:["Tensión del hilo"],ishikawa:{method:[],measurement:["Tensión del hilo"]},plans:[{id:"plan",causeId:"cause",causeCategory:"measurement"}]});
  const reopened=JSON.parse(JSON.stringify(next));
  expect(changeCause(reopened,"cause",{category:null}).plans[0].causeCategory).toBeUndefined();
  expect(removeCause(reopened,"cause")).toBe(reopened);
  const free={...reopened,rootCauseCauseId:undefined,plans:[]}; expect(removeCause(free,"cause")).toMatchObject({causeItems:[],brainstorm:["Tensión del hilo"],rootCauseWhys:["Medición"]});
});
it("rejects assistance from another claim context even when the problem and process match",()=>{
  const request=proposalContext("problema","QA","draft","customer","A","Tejido");
  expect(()=>assertProposalContext(request,"problema","QA","draft","customer","B","Tejido")).toThrow();
});
