import type { A3Analysis, AiDocumentReference } from "@/lib/types";
import { suggestedActionKey } from "@/lib/root2cause/action-plan";
export const a3Steps = ["Apertura", "Severidad", "5W2H", "Ideas", "Ishikawa 6M", "Causas", "5 Porqués", "Plan de acción"] as const;
export const stageFields = [
 ["eventType"], ["severityJustification"],
 ["fiveW2H.what", "fiveW2H.why", "fiveW2H.where", "fiveW2H.when", "fiveW2H.who", "fiveW2H.how", "fiveW2H.howMuch"],
 ["brainstorm"], ["ishikawa.workforce", "ishikawa.machinery", "ishikawa.method", "ishikawa.material", "ishikawa.environment", "ishikawa.measurement"],
 ["nonDetectionCause", "rootCause"], ["nonDetectionWhys", "rootCauseWhys"], [],
] as const;
export interface SuggestedAction { description:string; cause:string; expectedResult:string; completionEvidence:string; effectivenessMethod:string; documentRefs:string[]; }
export interface StageSuggestion { step:number; rationale:string; missingData:string[]; references:string[]; fields:Record<string,string|string[]>; actions:SuggestedAction[]; }
export interface RootCauseProposal { mode:"external"; stages:StageSuggestion[]; documents:AiDocumentReference[]; warnings:string[]; }
const text=(x:unknown)=>typeof x==="string"?x.trim().slice(0,6000):"";
const texts=(x:unknown)=>Array.isArray(x)?x.filter((v):v is string=>typeof v==="string").slice(0,30).map(text):[];
const arrayFields=new Set(["brainstorm","nonDetectionWhys","rootCauseWhys",...stageFields[4]]);
export function normalizeProposal(input:unknown,documents:AiDocumentReference[],requestedStep?:number):RootCauseProposal {
 if(!input||typeof input!=="object")throw new Error("La IA no devolvió un borrador válido.");
 const raw=input as {stages?:unknown;warnings?:unknown};
 if(!Array.isArray(raw.stages))throw new Error("Faltan las etapas del borrador.");
 const allowed=new Set(documents.map(d=>d.id)); const seen=new Set<number>();
 const stages:StageSuggestion[]=raw.stages.map((value:unknown)=>{
  if(!value||typeof value!=="object")throw new Error("Etapa inválida.");
  const s=value as Record<string,unknown>; const step=s.step;
  if(typeof step!=="number"||!Number.isInteger(step)||step<0||step>7||seen.has(step)||(requestedStep!==undefined&&step!==requestedStep))throw new Error("La IA devolvió una etapa no solicitada.");
  seen.add(step);
  const fields:Record<string,string|string[]>={};const source=s.fields&&typeof s.fields==="object"?s.fields as Record<string,unknown>:{};
  for(const key of stageFields[step])fields[key]=arrayFields.has(key)?texts(source[key]):text(source[key]);
  const refs=(v:unknown)=>texts(v).filter(id=>allowed.has(id));
  const actions:SuggestedAction[]=step===7&&Array.isArray(s.actions)?s.actions.slice(0,20).map(v=>{
   const a=v&&typeof v==="object"?v as Record<string,unknown>:{};
   const result={description:text(a.description),cause:text(a.cause),expectedResult:text(a.expectedResult),completionEvidence:text(a.completionEvidence),effectivenessMethod:text(a.effectivenessMethod),documentRefs:refs(a.documentRefs)};
   if(!result.description||!result.cause||!result.expectedResult||!result.completionEvidence||!result.effectivenessMethod)throw new Error("La acción propuesta carece de causa, resultado, evidencia o método de efectividad.");
   return result;
  }):[];
  return {step,rationale:text(s.rationale),missingData:texts(s.missingData),references:refs(s.references),fields,actions};
 });
 if(stages.length!==(requestedStep===undefined?8:1))throw new Error("El borrador no contiene todas las etapas solicitadas.");
 return {mode:"external",stages:stages.sort((a,b)=>a.step-b.step),documents,warnings:["Borrador: las causas son hipótesis; requieren evidencia y validación humana.",...texts(raw.warnings)]};
}
export function stageSnapshot(analysis:A3Analysis,step:number):string {
 const data=analysis as unknown as Record<string,unknown>;
 return JSON.stringify(step===7?analysis.plans:stageFields[step].map(k=>{const [a,b]=k.split('.');return b?(data[a] as Record<string,unknown>)?.[b]:data[a];}));
}
export function applyStageSuggestion(analysis:A3Analysis,suggestion:StageSuggestion,expected:string,reviewed=false):A3Analysis {
 if(reviewed)throw new Error("Esta etapa está validada. No se sobrescribe con IA.");
 if(stageSnapshot(analysis,suggestion.step)!==expected)throw new Error("La etapa cambió después de solicitar IA. Revisa el contenido y solicita una propuesta nueva.");
 const next=structuredClone(analysis); const target=next as unknown as Record<string,unknown>;
 for(const key of stageFields[suggestion.step]){
  let value=suggestion.fields[key];
  if (!value || (Array.isArray(value) && !value.some(item=>item.trim()))) continue;
  const [a,b]=key.split('.');
  if ((key==="nonDetectionWhys" || key==="rootCauseWhys") && Array.isArray(value)) {
    const offered=value;
    const existing=analysis[key];
    value=Array.from({length:Math.max(existing.length,offered.length)},(_,i)=>offered[i]?.trim() || existing[i] || "");
  }
  if(b)(target[a] as Record<string,unknown>)[b]=value;else target[a]=value;
 }
 if(suggestion.step===7){
  const additions=suggestion.actions.flatMap((action,index)=>{
   const sourceSuggestionKey=suggestedActionKey(suggestion.step,index,action.description,action.cause);
   if(next.plans.some(plan=>plan.sourceSuggestionKey===sourceSuggestionKey))return [];
   const cause=next.causeItems?.find(item=>item.text.trim()===action.cause.trim());
   return [{...action,id:crypto.randomUUID(),owner:"",dueDate:"",status:"pending" as const,
    ...(cause?{causeId:cause.id,causeCategory:cause.category??undefined}:{}),sourceSuggestionKey}];
  });
  next.plans=[...next.plans,...additions];
 }
 return next;
}
export function relevantExcerpts(textContent:string,query:string,max=6000):string {
 const words=query.toLocaleLowerCase("es").match(/[\p{L}\p{N}]{3,}/gu)??[];
 const chunks=textContent.replace(/\s+/g," ").match(/.{1,900}/g)??[];
 const counts=new Map<string,number>();
 for(const word of words)counts.set(word,(counts.get(word)??0)+1);
 return chunks.map((content,index)=>{
   const lower=content.toLocaleLowerCase("es");
   let score=0;
   for(const [word,count] of counts)if(lower.includes(word))score+=count;
   return {content,index,score};
 }).filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,6).map(c=>c.content).join("\n").slice(0,max);
}

/** Context guard remains stable when accepting other stages of the same draft. */
export function proposalContext(problem:string,processId:string|undefined,...scope:(string|undefined)[]):string {
 return JSON.stringify([problem,processId??null,...scope]);
}
export function assertProposalContext(expected:string,problem:string,processId:string|undefined,...scope:(string|undefined)[]){
 if(expected!==proposalContext(problem,processId,...scope))throw new Error("El contexto o proceso cambió. Solicita un borrador nuevo antes de incorporar propuestas.");
}

/** A manual edit in any contributing stage invalidates the outstanding proposal. */
export function assertProposalSnapshots(analysis:A3Analysis,expected:readonly string[]):void {
 if(expected.length!==a3Steps.length||a3Steps.some((_,i)=>stageSnapshot(analysis,i)!==expected[i])){
  throw new Error("El expediente cambió después de solicitar IA. Revisa los cambios y solicita una propuesta nueva.");
 }
}
