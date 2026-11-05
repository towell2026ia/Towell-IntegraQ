import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { activeSession } from "./session-data";
import { clearContinuity, continuityDiagnostics, continuityIdentity, ensureContinuityIdentity, hasUnsavedChanges, listenForBackgroundRefresh, markDirty, readContinuity, sessionAccessKey, writeContinuity } from "./workspace-continuity";

function storage() {
  const result:Record<string,unknown>={};
  Object.defineProperties(result,{
    getItem:{value:(key:string)=>result[key]??null},
    setItem:{value:(key:string,value:string)=>{result[key]=value;}},
    removeItem:{value:(key:string)=>{delete result[key];}},
  });
  return result as unknown as Storage;
}
const session={...activeSession,authUserId:"user-a",organizationId:"org-a"};
let browser:EventTarget & {sessionStorage:Storage;localStorage:Storage};
let page:EventTarget & {visibilityState:string};
beforeEach(()=>{
  browser=Object.assign(new EventTarget(),{sessionStorage:storage(),localStorage:storage()});
  page=Object.assign(new EventTarget(),{visibilityState:"visible"});
  vi.stubGlobal("window",browser);vi.stubGlobal("document",page);vi.stubGlobal("navigator",{onLine:true});
  clearContinuity();vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe("private workspace continuity",()=>{
  it("treats equivalent session objects and reordered permission arrays as the same access",()=>{
    const initial={...session,assignedProcessIds:["P-01","P-02"]};
    expect(sessionAccessKey(initial)).toBe(sessionAccessKey({...initial,assignedProcessIds:["P-02","P-01"]}));
    expect(sessionAccessKey(initial)).not.toBe(sessionAccessKey({...initial,assignedProcessIds:["P-01"]}));
  });
  it("isolates users, organizations and demo mode",()=>{
    const identity=continuityIdentity(session),access=sessionAccessKey(session);
    expect(writeContinuity(identity,access,"draft:claim",{title:"Texto sin guardar"})).toBe(true);
    expect(readContinuity(identity,access,"draft:claim")).toEqual({title:"Texto sin guardar"});
    for(const changed of[{...session,authUserId:"user-b"},{...session,organizationId:"org-b"},{...session,workspaceMode:"demo" as const}])expect(readContinuity(continuityIdentity(changed),sessionAccessKey(changed),"draft:claim")).toBeNull();
  });
  it("invalidates a stored context after permission changes",()=>{
    const id=continuityIdentity(session);writeContinuity(id,sessionAccessKey(session),"navigation:module","customers");
    expect(readContinuity(id,sessionAccessKey({...session,userType:"Cliente"}),"navigation:module")).toBeNull();
  });
  it("purges old identities and revoked access without deleting real module records",()=>{
    const id=continuityIdentity(session),access=sessionAccessKey(session);ensureContinuityIdentity(id,access);writeContinuity(id,access,"draft",{title:"Privado"});
    ensureContinuityIdentity(id,access);expect(readContinuity(id,access,"draft")).toEqual({title:"Privado"});
    ensureContinuityIdentity(id,sessionAccessKey({...session,userType:"Usuario interno"}));expect(readContinuity(id,access,"draft")).toBeNull();
    writeContinuity(id,access,"draft",{title:"Privado"});ensureContinuityIdentity("another-user:org",access);expect(readContinuity(id,access,"draft")).toBeNull();
  });
  it("expires drafts after eight hours",()=>{
    const id=continuityIdentity(session),access=sessionAccessKey(session);writeContinuity(id,access,"draft",{description:"Texto"});
    vi.advanceTimersByTime(8*3600000+1);expect(readContinuity(id,access,"draft")).toBeNull();
  });
  it.each([{password:"x"},{accessToken:"x"},{authorization:"x"},{nested:{secret:"x"}},new Uint8Array([1,2])])("does not persist credentials or binary values %#",value=>{
    expect(writeContinuity(continuityIdentity(session),sessionAccessKey(session),"draft",value)).toBe(false);
    expect(Object.keys(browser.sessionStorage)).toHaveLength(0);
  });
  it("clears context and legacy unscoped drafts at logout, preserving actual module records",()=>{
    const id=continuityIdentity(session),access=sessionAccessKey(session);writeContinuity(id,access,"draft",{title:"Texto"});
    browser.localStorage.setItem("integraq.a3Draft","legacy");browser.localStorage.setItem("integraq.controlledDocuments.v1","historical");
    markDirty("form",true);expect(hasUnsavedChanges()).toBe(true);clearContinuity();expect(hasUnsavedChanges()).toBe(false);
    expect(readContinuity(id,access,"draft")).toBeNull();expect(browser.localStorage.getItem("integraq.a3Draft")).toBeNull();expect(browser.localStorage.getItem("integraq.controlledDocuments.v1")).toBe("historical");
  });
  it("fails safely when storage is denied",()=>{
    Object.defineProperty(browser,"sessionStorage",{get:()=>{throw new Error("denied");}});
    expect(writeContinuity(continuityIdentity(session),sessionAccessKey(session),"draft",{})).toBe(false);
    expect(readContinuity(continuityIdentity(session),sessionAccessKey(session),"draft")).toBeNull();
  });
});
describe("background refresh coordination",()=>{
  it("does not poll during a long idle session; coalesces focus and visibility",async()=>{
    const refresh=vi.fn(async()=>undefined),stop=listenForBackgroundRefresh("test",refresh);
    await vi.advanceTimersByTimeAsync(30*60000);expect(refresh).not.toHaveBeenCalled();
    browser.dispatchEvent(new Event("focus"));page.dispatchEvent(new Event("visibilitychange"));await Promise.resolve();await Promise.resolve();expect(refresh).toHaveBeenCalledTimes(1);
    for(let i=0;i<20;i++)browser.dispatchEvent(new Event("focus"));expect(refresh).toHaveBeenCalledTimes(1);stop();
  });
  it("does not overlap slow requests and stops after unmount",async()=>{
    let resolve:()=>void=()=>undefined;const refresh=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));
    const stop=listenForBackgroundRefresh("slow",refresh);vi.advanceTimersByTime(60001);browser.dispatchEvent(new Event("focus"));await Promise.resolve();
    vi.advanceTimersByTime(120000);browser.dispatchEvent(new Event("focus"));expect(refresh).toHaveBeenCalledTimes(1);resolve();await Promise.resolve();await Promise.resolve();
    stop();vi.advanceTimersByTime(120000);browser.dispatchEvent(new Event("focus"));expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("skips hidden or offline pages and emits only sanitized diagnostic events",async()=>{
    const refresh=vi.fn(async()=>undefined),stop=listenForBackgroundRefresh("claims",refresh);vi.advanceTimersByTime(60001);
    page.visibilityState="hidden";browser.dispatchEvent(new Event("focus"));await Promise.resolve();expect(refresh).not.toHaveBeenCalled();
    page.visibilityState="visible";browser.dispatchEvent(new Event("online"));await Promise.resolve();expect(refresh).toHaveBeenCalledTimes(1);
    expect(continuityDiagnostics().every(event=>Object.keys(event).sort().join(",")==="at,source,type")).toBe(true);stop();
  });
});
