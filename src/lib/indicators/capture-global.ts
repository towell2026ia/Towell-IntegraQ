import type { Quarter } from '@/lib/indicator-data';
import { buildDefaultCaptureWindows } from './indicator-windows';
export type CaptureScope = {year:number;quarter:Quarter;opensAt:string;closesAt:string};
export type CaptureRow = {indicatorId:string;code:string;name:string;processId:string;year:number;quarter:Quarter;periodId:string|null;updatedAt:string|null;source:'legacy'|'global'|'exception';exceptionReason:string|null;opensBefore:string|null;closesBefore:string|null;opensAfter:string;closesAfter:string;preserved:boolean};
export type CapturePreview = {token:string;scope:CaptureScope[];rows:CaptureRow[];rules:{year:number;quarter:Quarter;opens_at:string;closes_at:string}[];defaultDays:number;includeExceptions:boolean;indicators:number;windows:number;exceptions:number};
export function validateCaptureScope(value:unknown):value is CaptureScope[] {
  if(!Array.isArray(value)||value.length<1||value.length>12)return false;
  const seen=new Set<string>();
  return value.every(v=>{
    if(!v||typeof v!=='object'||!Number.isInteger(v.year)||v.year<2020||v.year>2200||!['Q1','Q2','Q3','Q4'].includes(v.quarter))return false;
    if(typeof v.opensAt!=='string'||typeof v.closesAt!=='string'||!/[T].*(Z|[+-]\d{2}:\d{2})$/.test(v.opensAt)||!/[T].*(Z|[+-]\d{2}:\d{2})$/.test(v.closesAt))return false;
    if(!Number.isFinite(Date.parse(v.opensAt))||!Number.isFinite(Date.parse(v.closesAt))||Date.parse(v.opensAt)>Date.parse(v.closesAt))return false;
    const key=`${v.year}:${v.quarter}`;if(seen.has(key))return false;seen.add(key);return true;
  });
}
export function recoveryPreview(before:CapturePreview,current:CapturePreview):CapturePreview {
  return {...current,rows:current.rows.map(row=>{
    const previous=before.rows.find(r=>r.indicatorId===row.indicatorId&&r.year===row.year&&r.quarter===row.quarter);
    if(!previous)throw Error('La lista de indicadores cambió.');
    const rule=before.rules.find(r=>r.year===row.year&&r.quarter===row.quarter);
    const defaults=buildDefaultCaptureWindows(row.year,before.defaultDays)[row.quarter];
    return {...row,opensAfter:previous.opensBefore??rule?.opens_at??defaults.opensAt,closesAfter:previous.closesBefore??rule?.closes_at??defaults.closesAt,preserved:false};
  }),windows:current.rows.length,exceptions:0};
}
export async function captureRequest<T>(body:unknown):Promise<T> {
  const r=await fetch('/api/indicators/capture-windows',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw Error(data.error??'No fue posible actualizar las ventanas.');return data;
}
