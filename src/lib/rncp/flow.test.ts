import {describe,it,expect} from "vitest";
import {compareRncpFolios} from "./folio";
import {isRncpClassification,reportOperationalState} from "./flow";
import type {RncpReport} from "../rncp-data";
const base:RncpReport={id:"r",folio:"RNCP0006",status:"submitted",origin:"native",late:false,portalVisible:true,createdAt:"2026-11-01",updatedAt:"2026-11-01",history:[],actions:[]};
describe("official flow presentation",()=>{
 it("sorts long consecutive numbers without precision loss or date-based ordering",()=>{
  const rows=["RNCP9","RNCP0010","RNCP9007199254740993","RNCP9007199254740992","RNCP-2026-ABC"].map(folio=>({folio}));
  expect([...rows].sort(compareRncpFolios).map(r=>r.folio)).toEqual(["RNCP9007199254740993","RNCP9007199254740992","RNCP0010","RNCP9","RNCP-2026-ABC"]);expect(rows[4].folio).toBe("RNCP-2026-ABC");
 });
 it.each(["QAC","Hilo","Avíos"])("allows explicit %s",value=>expect(isRncpClassification(value)).toBe(true));
 it.each(["Colorantes","Químico","Auxiliar",undefined,"hilo"])("never infers %s",value=>expect(isRncpClassification(value)).toBe(false));
 it("keeps a legacy closed category without inventing communication",()=>expect(reportOperationalState({...base,origin:"legacy",status:"closed"},"2026-11-02T18:00:00Z")).toBe("closed"));
 it("does not treat saving as notification",()=>expect(reportOperationalState(base,"2026-11-02T18:00:00Z")).toBe("draft"));
 it("accepted communication begins in process without automatic closure",()=>expect(reportOperationalState({...base,notifiedAt:"2026-11-02T17:00:00Z"},"2026-11-02T18:00:00Z")).toBe("in_process"));
 it.each([["Cerrado","closed"],["Tarde","late"],["En Proceso","in_process"]])("preserves original %s without inventing dates",(historicalStatus,state)=>expect(reportOperationalState({...base,origin:"historical",historicalStatus},"2026-11-02T18:00:00Z")).toBe(state));
 it("keeps validated closure separate from lateness",()=>expect(reportOperationalState({...base,notifiedAt:"2026-11-01T18:00:00Z",closedAt:"2026-11-10T18:00:00Z",validationOutcome:"accepted",late:true},"2026-11-11T18:00:00Z")).toBe("closed"));
});
