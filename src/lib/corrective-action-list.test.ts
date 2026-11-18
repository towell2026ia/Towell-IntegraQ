import { describe, expect, it } from "vitest";
import { matchesCorrectiveListScope, type CorrectiveListScope } from "./corrective-action-list";
import type { CorrectiveAction } from "./types";
const open={source:"internal",status:"open"} as CorrectiveAction;
const closed={...open,status:"closed"} as CorrectiveAction;
describe("Root2Cause operational list scopes",()=>{
  it("all includes both open and closed retained actions",()=>{expect([open,closed].filter(a=>matchesCorrectiveListScope(a,"all"))).toEqual([open,closed]);});
  it("open and closed do not mix",()=>{expect([open,closed].filter(a=>matchesCorrectiveListScope(a,"open"))).toEqual([open]);expect([open,closed].filter(a=>matchesCorrectiveListScope(a,"closed"))).toEqual([closed]);});
  it.each(["open","closed","all","customer","internal","system"] as CorrectiveListScope[])("%s excludes retired and supplier actions",scope=>{expect(matchesCorrectiveListScope({...open,deletedAt:"2099-01-01"},scope)).toBe(false);expect(matchesCorrectiveListScope({...open,source:"supplier"},scope)).toBe(false);});
  it("keeps audit and SGC origins distinct from customer and internal actions",()=>{expect(matchesCorrectiveListScope({...open,source:"audit"},"system")).toBe(true);expect(matchesCorrectiveListScope({...open,source:"sgc"},"system")).toBe(true);expect(matchesCorrectiveListScope({...open,source:"customer"},"system")).toBe(false);expect(matchesCorrectiveListScope(open,"system")).toBe(false);});
});
