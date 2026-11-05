"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import type { ActiveSession } from "@/lib/session-data";
import { continuityIdentity, sessionAccessKey, readContinuity, writeContinuity, removeContinuity, markDirty, hasUnsavedChanges, traceContinuity, continuityDiagnostics, ensureContinuityIdentity } from "@/lib/workspace-continuity";

const Context=createContext({identity:null as string|null,access:""});
export function ContinuityProvider({session,children}:{session:ActiveSession;children:ReactNode}) {
  const identity=continuityIdentity(session),access=sessionAccessKey(session);
  useLayoutEffect(()=>{ensureContinuityIdentity(identity,access);},[identity,access]);
  useEffect(()=>{
    traceContinuity("mount","workspace");
    const navigation=performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming|undefined;
    traceContinuity("document-navigation",navigation?.type??"unknown");
    const report=()=>continuityDiagnostics();
    Object.assign(window,{__integraqContinuityDiagnostics:report});
    const beforeUnload=(event:BeforeUnloadEvent)=>{traceContinuity("before-unload","document");if(hasUnsavedChanges()){event.preventDefault();event.returnValue="";}};
    const offline=()=>traceContinuity("offline","network"),online=()=>traceContinuity("online","network");
    window.addEventListener("beforeunload",beforeUnload);window.addEventListener("offline",offline);window.addEventListener("online",online);
    return ()=>{traceContinuity("unmount","workspace");window.removeEventListener("beforeunload",beforeUnload);window.removeEventListener("offline",offline);window.removeEventListener("online",online);};
  },[identity]);
  return <Context.Provider value={{identity,access}}>{children}</Context.Provider>;
}
export function useContinuityState<T>(key:string,initial:T|(()=>T)):[T,Dispatch<SetStateAction<T>>] {
  const scope=useContext(Context);
  const [value,setValue]=useState(initial);
  const initialRef=useRef(value);
  const current=useRef(value);
  useLayoutEffect(()=>{
    const restored=readContinuity<T>(scope.identity,scope.access,key);
    const fallback=initialRef.current;
    const next=restored!==null&&typeof restored===typeof fallback?restored:fallback;
    if(restored===null)writeContinuity(scope.identity,scope.access,key,next);
    current.current=next;setValue(next);
  },[scope.identity,scope.access,key]);
  const update=useCallback<Dispatch<SetStateAction<T>>>((change)=>{
    const next=typeof change==="function"?(change as (value:T)=>T)(current.current):change;
    current.current=next;setValue(next);writeContinuity(scope.identity,scope.access,key,next);
  },[scope.identity,scope.access,key]);
  return [value,update];
}

type FormDraft={fields:Record<string,string>;hasAttachments:boolean};
export function useFormDraft(key:string,fields:readonly string[],validate:(values:Record<string,string>)=>Record<string,string> = values=>values) {
  const scope=useContext(Context),formRef=useRef<HTMLFormElement>(null);
  const attachForm=useCallback((form:HTMLFormElement|null)=>{formRef.current=form;},[]);
  const options=useRef({fields,validate});
  const attachmentExpected=useRef(false);
  useLayoutEffect(()=>{options.current={fields,validate};});
  const [recovered,setRecovered]=useState(false),[attachments,setAttachments]=useState(false),[storageError,setStorageError]=useState(false);
  const dirtyKey=`${scope.identity}:${key}`;
  const capture=useCallback(()=>{
    const form=formRef.current;if(!form)return;
    const data=new FormData(form),values:Record<string,string>={};
    for(const name of options.current.fields){const value=data.get(name);if(typeof value==="string")values[name]=value;}
    const hasAttachments=attachmentExpected.current||Array.from(form.querySelectorAll<HTMLInputElement>('input[type="file"]')).some(input=>Boolean(input.files?.length));
    attachmentExpected.current=hasAttachments;
    markDirty(dirtyKey,true);
    if(!writeContinuity(scope.identity,scope.access,`draft:${key}`,{fields:values,hasAttachments}))setStorageError(true);
  },[scope.identity,scope.access,key,dirtyKey]);
  useLayoutEffect(()=>{
    const form=formRef.current;if(!form)return;
    let restoring=true;
    let interacted=false;
    let frame:number|undefined;
    traceContinuity("mount","form");
    const stored=readContinuity<FormDraft>(scope.identity,scope.access,`draft:${key}`);
    if(stored?.fields){
      const values=options.current.validate(stored.fields);
      const pending:string[]=[];
      const apply=(names:readonly string[])=>{for(const name of names){
        const input=form.elements.namedItem(name);
        if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement||input instanceof HTMLSelectElement)||input.disabled||input instanceof HTMLInputElement&&["file","password","hidden"].includes(input.type)||typeof values[name]!=="string")continue;
        if(input instanceof HTMLSelectElement&&!Array.from(input.options).some(option=>option.value===values[name])){pending.push(name);continue;}
        const prototype=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype,"value")?.set?.call(input,values[name]);
        input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));
      }};
      apply(options.current.fields);restoring=false;
      // Controlled customer fields may populate dependent selects in the next commit.
      frame=requestAnimationFrame(()=>{if(!interacted){restoring=true;apply([...pending]);restoring=false;}});
      attachmentExpected.current=stored.hasAttachments===true;
      queueMicrotask(()=>{setRecovered(true);setAttachments(stored.hasAttachments===true);});markDirty(dirtyKey,true);traceContinuity("draft-restored","form");
    } else restoring=false;
    const changed=()=>{if(!restoring){interacted=true;capture();}};
    form.addEventListener("input",changed);form.addEventListener("change",changed);
    return ()=>{if(frame!==undefined)cancelAnimationFrame(frame);form.removeEventListener("input",changed);form.removeEventListener("change",changed);markDirty(dirtyKey,false);traceContinuity("unmount","form");};
  },[scope.identity,scope.access,key,dirtyKey,capture]);
  const clear=()=>{removeContinuity(scope.identity,`draft:${key}`);markDirty(dirtyKey,false);attachmentExpected.current=false;setRecovered(false);setAttachments(false);};
  return {formRef:attachForm,clear,capture,notice:storageError?"No se pudo conservar el borrador en esta pestaña. No cierres la captura sin guardar.":recovered?`Se recuperó tu borrador. Revisa los datos y confirma el guardado.${attachments?" Vuelve a seleccionar los archivos adjuntos.":""}`:""};
}

export function useScopedDraft<T>(key:string) {
  const scope=useContext(Context);
  return useMemo(()=>({
    read:()=>readContinuity<T>(scope.identity,scope.access,`draft:${key}`),
    write:(value:T)=>writeContinuity(scope.identity,scope.access,`draft:${key}`,value),
    clear:()=>{removeContinuity(scope.identity,`draft:${key}`);markDirty(`${scope.identity}:${key}`,false);},
    dirty:(value:boolean)=>markDirty(`${scope.identity}:${key}`,value),
  }),[scope.identity,scope.access,key]);
}

export function useNavigationScroll(module:string) {
  const scope=useContext(Context);
  useLayoutEffect(()=>{
    const saved=readContinuity<number>(scope.identity,scope.access,`scroll:${module}`);
    const wanted=typeof saved==="number"&&Number.isFinite(saved)?Math.max(0,saved):0;
    let restoring=true;
    const restore=()=>{if(restoring&&document.documentElement.scrollHeight>=wanted+window.innerHeight){window.scrollTo(0,Math.max(0,wanted));restoring=false;}};
    const interact=()=>{restoring=false;};
    const capture=()=>{if(!restoring)writeContinuity(scope.identity,scope.access,`scroll:${module}`,Math.max(0,window.scrollY));};
    const observer=new ResizeObserver(restore);observer.observe(document.body);restore();
    window.addEventListener("scroll",capture,{passive:true});window.addEventListener("wheel",interact,{passive:true});window.addEventListener("pointerdown",interact);window.addEventListener("keydown",interact);
    return ()=>{observer.disconnect();window.removeEventListener("scroll",capture);window.removeEventListener("wheel",interact);window.removeEventListener("pointerdown",interact);window.removeEventListener("keydown",interact);};
  },[module,scope.identity,scope.access]);
}
