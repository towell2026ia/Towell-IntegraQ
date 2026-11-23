import {assertRootCauseRedboothTarget} from "./redbooth-target";
import type {A3ActionPlanItem,CorrectiveAction} from "@/lib/types";
export interface RedboothMember {id:number;name:string;email?:string;}
export interface RedboothTask {id:number;url:string;projectId:number;listId:number;status:string;}
export interface RedboothTaskInput {project_id:number;task_list_id:number;name:string;description:string;assigned_user_ids:number[];due_on:string;}
export function resolveRedboothOwner(owner:string,members:RedboothMember[],selectedId?:number){
 const normalize=(v:string)=>v.trim().normalize('NFC').toLocaleLowerCase('es');
 if(selectedId!==undefined){const member=members.find(m=>m.id===selectedId);if(!member)throw new Error('Responsable no autorizado en el proyecto.');return member;}
 const matches=members.filter(m=>normalize(m.name)===normalize(owner)||Boolean(m.email&&normalize(m.email)===normalize(owner)));
 if(matches.length!==1)throw new Error('Selecciona manualmente al responsable: coincidencia ausente o ambigua.');return matches[0];
}
export function buildRedboothTask(action:CorrectiveAction,plan:A3ActionPlanItem,target:{projectId:number;listId:number},member:RedboothMember):RedboothTaskInput{
 assertRootCauseRedboothTarget(target.projectId,target.listId);
 if(!plan.description.trim()||!plan.owner.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(plan.dueDate)||Number.isNaN(Date.parse(plan.dueDate)))throw new Error('La acción requiere descripción, responsable y fecha verificados.');
 return {project_id:target.projectId,task_list_id:target.listId,name:`${action.folio} · ${plan.description}`.slice(0,240),description:[`Expediente: ${action.folio}`,plan.description,`Causa: ${plan.cause??action.a3?.rootCause??'Pendiente de confirmar'}`,`Resultado esperado: ${plan.expectedResult??'Pendiente de confirmar'}`,`Evidencia: ${plan.completionEvidence??'Pendiente de confirmar'}`,`Verificación de efectividad: ${plan.effectivenessMethod??'Pendiente de confirmar'}`].join('\n'),assigned_user_ids:[member.id],due_on:plan.dueDate};
}
/** Adapter uses the existing internal connector. No guessed HTTP write routes. */
export interface RedboothConnector {
 createTask(input:RedboothTaskInput,correlation:string):Promise<RedboothTask>;
 updateTask(id:number,input:RedboothTaskInput,expectedRemoteVersion:string):Promise<RedboothTask>;
 getTask(id:number):Promise<RedboothTask>;
 attachPdf?: (task:RedboothTask,pdf:{bytes:Uint8Array;name:string;sha256:string},correlation:string)=>Promise<string>;
}
export interface SyncLedger {
 // Must be durable and atomic in the existing DB before enabling real writes.
 claim(key:string,fingerprint:string):Promise<{state:'new'|'done'|'uncertain';task?:RedboothTask;attachment?:string}>;
 created(key:string,task:RedboothTask):Promise<void>;
 complete(key:string,result:{task:RedboothTask;attachment?:string}):Promise<void>;
 uncertain(key:string):Promise<void>;
}
export async function synchronizeApprovedAction(input:{organizationId:string;actionId:string;planId:string;approved:boolean;reason:string;fingerprint:string;task:RedboothTaskInput;pdf?:{bytes:Uint8Array;name:string;sha256:string}},connector:RedboothConnector,ledger:SyncLedger){
 assertRootCauseRedboothTarget(input.task.project_id,input.task.task_list_id);
 if(!input.approved||!input.reason.trim())throw new Error('Se requiere aprobación explícita y motivo.');
 if(input.pdf){
 if(!/^[a-f0-9]{64}$/.test(input.pdf.sha256)||new TextDecoder().decode(input.pdf.bytes.subarray(0,5))!=='%PDF-')throw new Error('Se requiere PDF oficial verificado.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(input.pdf.bytes).buffer))).map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==input.pdf.sha256)throw new Error('La integridad del PDF oficial no coincide.');
 }
 const key=[input.organizationId,input.actionId,input.planId,input.task.project_id,input.task.task_list_id].join(':');
 const claimed=await ledger.claim(key,input.fingerprint);
 if(claimed.state==='done'){
  if(!claimed.task)throw new Error('Falta verificar la tarea previamente vinculada.');
  assertRootCauseRedboothTarget(claimed.task.projectId,claimed.task.listId);
  return {task:claimed.task,reused:true,attachmentPending:!claimed.attachment};
 }
 if(claimed.state==='uncertain')throw new Error('Sincronización en curso o resultado incierto. Conciliar; no repetir la creación.');
 try{
  const task=await connector.createTask(input.task,key);
  if(!Number.isSafeInteger(task.id)||task.id<=0||task.projectId!==input.task.project_id||task.listId!==input.task.task_list_id||!/^https:\/\/(www\.)?redbooth\.com\//.test(task.url))throw new Error('La tarea retornada no corresponde al destino autorizado.');
  await ledger.created(key,task);
  const attachment=connector.attachPdf && input.pdf?await connector.attachPdf(task,input.pdf,key):undefined;
  await ledger.complete(key,{task,attachment});return {task,reused:false,attachmentPending:!attachment};
 }catch(error){await ledger.uncertain(key);throw error;}
}

export interface RedboothHierarchyConnector extends RedboothConnector {
  createSubtask(parent: RedboothTask, input: RedboothTaskInput, correlation:string):Promise<RedboothTask>;
}
type ApprovedTask = Parameters<typeof synchronizeApprovedAction>[0];

// All remote mutations are supplied by a contract-verified transport. A child cannot be
// reserved until the parent ID is confirmed; unknown outcomes require reconciliation.
export async function synchronizeApprovedPlan(parent:ApprovedTask, children:ApprovedTask[], connector:RedboothHierarchyConnector, ledger:SyncLedger) {
  if(parent.planId!=="principal" || !parent.approved || !children.length || new Set(children.map(c=>c.planId)).size!==children.length ||
    children.some(c=>c.planId==="principal" || !c.planId || !c.approved || !c.reason.trim() || c.organizationId!==parent.organizationId || c.actionId!==parent.actionId)) {
    throw new Error("El expediente y todas las acciones deben pertenecer al mismo plan aprobado.");
  }
  for(const child of children) assertRootCauseRedboothTarget(child.task.project_id,child.task.task_list_id);
  const main = await synchronizeApprovedAction(parent,connector,ledger);
  const subtasks = [];
  for(const child of children) {
    const scoped:RedboothConnector = {
      createTask:(input,key)=>connector.createSubtask(main.task,input,key),
      updateTask:(...args)=>connector.updateTask(...args), getTask:id=>connector.getTask(id),
    };
    subtasks.push(await synchronizeApprovedAction(child,scoped,ledger));
  }
  return {main,subtasks};
}
