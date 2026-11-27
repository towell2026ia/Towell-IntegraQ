"use client";
import { useCallback, useEffect, useState } from "react";
import type { ActiveSession } from "@/lib/session-data";
import { readReviewPeriods, reviewMinutes } from "@/lib/review-document-storage";
import { ReviewDocuments } from "./review-documents";

const periods = new WeakMap<ActiveSession,{time:number; value:Awaited<ReturnType<typeof readReviewPeriods>>}>();
export function useReviewMinutes(session:ActiveSession) {
  const [value,setValue]=useState({years:[] as number[],installed:false});
  const [loading,setLoading]=useState(true);
  const [loadError,setError]=useState("");
  const [attempt,setAttempt]=useState(0);
  const reload=useCallback(()=>{periods.delete(session);setLoading(true);setAttempt(n=>n+1);},[session]);
  useEffect(()=>{
    let active=true;
    const entry=periods.get(session);
    const promise=entry && Date.now()-entry.time<30000 ? Promise.resolve(entry.value) : readReviewPeriods();
    void promise.then(next=>{if(active){periods.set(session,{time:entry?.value===next?entry.time:Date.now(),value:next});setValue(next);setError("");}})
      .catch(()=>{if(active){setValue({years:[],installed:false});setError("No se pudieron consultar los períodos.");}})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[attempt,session]);
  return {...value,loading,loadError,reload};
}
export function ManagementReviewMinutes(props:{session:ActiveSession;period:number;catalog:ReturnType<typeof useReviewMinutes>;onYear:(year:number)=>void}) {
  return <ReviewDocuments {...props} kind={reviewMinutes}/>;
}
