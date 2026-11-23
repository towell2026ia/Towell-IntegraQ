import {describe,it,expect,vi} from 'vitest';
import {buildRedboothTask,resolveRedboothOwner,synchronizeApprovedAction,synchronizeApprovedPlan,type SyncLedger,type RedboothConnector} from './redbooth';
import {ROOT2CAUSE_REDBOOTH_TARGET as target} from './redbooth-target';
import type {CorrectiveAction} from '@/lib/types';
const action={id:'case',folio:'AC-1'} as CorrectiveAction;
const plan={id:'plan',description:'Verificar control',owner:'Ana',dueDate:'2026-11-20',status:'pending' as const};
const task=buildRedboothTask(action,plan,target,{id:3,name:'Ana'});
async function setup(){const bytes=new TextEncoder().encode('%PDF-1.4 local unit bytes');const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');const input={organizationId:'org-a',actionId:'case',planId:'plan',approved:true,reason:'Plan revisado',fingerprint:'f1',task,pdf:{bytes,name:'A3.pdf',sha256}};let state:'new'|'done'|'uncertain'='new';let fingerprint='';const remote={id:9,url:'https://redbooth.com/a/#!/projects/2233821/tasks/9',projectId:2233821,listId:6673813,status:'new'};
 const ledger:SyncLedger={claim:vi.fn(async(_key,fp)=>{if(fingerprint&&fingerprint!==fp)throw new Error('Versión diferente');fingerprint=fp;const current=state;state='uncertain';return {state:current,task:current==='done'?remote:undefined};}),created:vi.fn(async()=>{}),complete:vi.fn(async()=>{state='done';}),uncertain:vi.fn(async()=>{state='uncertain';})};
 const connector:RedboothConnector={createTask:vi.fn(async()=>remote),updateTask:vi.fn(async()=>remote),getTask:vi.fn(async()=>remote)};return {input,ledger,connector};}
describe('Redbooth local connector contract',()=>{
 it('requires manual choice for ambiguous names',()=>expect(()=>resolveRedboothOwner('Ana',[{id:1,name:'Ana'},{id:2,name:'Ana'}])).toThrow(/ambigua/));
 it('does not assign approximate matches',()=>expect(()=>resolveRedboothOwner('An',[{id:1,name:'Ana'}])).toThrow());
 it('validates manually selected users against project membership',()=>expect(()=>resolveRedboothOwner('Ana',[{id:1,name:'Ana'}],2)).toThrow());
 it('supports an explicit verified choice',()=>expect(resolveRedboothOwner('Ana',[{id:1,name:'Ana'},{id:2,name:'Ana'}],2).id).toBe(2));
 it('requires an exact list identifier',()=>expect(()=>buildRedboothTask(action,plan,{projectId:1,listId:0},{id:3,name:'Ana'})).toThrow());
 it('keeps concrete action data and assigned ID',()=>expect(task).toMatchObject({assigned_user_ids:[3],due_on:plan.dueDate,name:'AC-1 · Verificar control'}));
 it('does not create without approval and reason',async()=>{const s=await setup();await expect(synchronizeApprovedAction({...s.input,approved:false},s.connector,s.ledger)).rejects.toThrow();expect(s.connector.createTask).not.toHaveBeenCalled();});
 it('verifies exact PDF bytes before reserve or send',async()=>{const s=await setup();s.input.pdf.bytes[7]=90;await expect(synchronizeApprovedAction(s.input,s.connector,s.ledger)).rejects.toThrow(/integridad/);expect(s.ledger.claim).not.toHaveBeenCalled();});
 it('retries a completed request without a duplicate task',async()=>{const s=await setup();await synchronizeApprovedAction(s.input,s.connector,s.ledger);const r=await synchronizeApprovedAction(s.input,s.connector,s.ledger);expect(r.reused).toBe(true);expect(s.connector.createTask).toHaveBeenCalledTimes(1);});
 it('blocks concurrent duplicate creation',async()=>{const s=await setup();const r=await Promise.allSettled([synchronizeApprovedAction(s.input,s.connector,s.ledger),synchronizeApprovedAction(s.input,s.connector,s.ledger)]);expect(r.some(x=>x.status==='fulfilled')).toBe(true);expect(s.connector.createTask).toHaveBeenCalledTimes(1);});
 it('does not retry a lost remote response automatically',async()=>{const s=await setup();vi.mocked(s.connector.createTask).mockRejectedValue(new Error('Timeout'));await expect(synchronizeApprovedAction(s.input,s.connector,s.ledger)).rejects.toThrow();await expect(synchronizeApprovedAction(s.input,s.connector,s.ledger)).rejects.toThrow(/incierto/);expect(s.connector.createTask).toHaveBeenCalledTimes(1);});
 it('marks an unsupported PDF attachment as pending',async()=>{const s=await setup();expect((await synchronizeApprovedAction(s.input,s.connector,s.ledger)).attachmentPending).toBe(true);});
 it('passes the same official bytes to an available attachment operation',async()=>{const s=await setup();s.connector.attachPdf=vi.fn(async()=>'file-1');await synchronizeApprovedAction(s.input,s.connector,s.ledger);expect(s.connector.attachPdf).toHaveBeenCalledWith(expect.objectContaining({id:9}),s.input.pdf,expect.stringContaining('org-a:case:plan'));});
 it('rejects a changed approved fingerprint on retry',async()=>{const s=await setup();await synchronizeApprovedAction(s.input,s.connector,s.ledger);await expect(synchronizeApprovedAction({...s.input,fingerprint:'different'},s.connector,s.ledger)).rejects.toThrow(/Versión/);});
 it('does not overwrite or delete existing tasks during creation',async()=>{const s=await setup();await synchronizeApprovedAction(s.input,s.connector,s.ledger);expect(s.connector.updateTask).not.toHaveBeenCalled();});
});

it('rejects the former example project before building a task',()=>{expect(()=>buildRedboothTask(action,plan,{projectId:2113514,listId:6673813},{id:3,name:'Ana'})).toThrow(/QTW/);});
it('rejects a different list even inside QTW',()=>{expect(()=>buildRedboothTask(action,plan,{projectId:2233821,listId:1},{id:3,name:'Ana'})).toThrow(/QTW/);});
it('rejects tampered destination before reserving or calling any connector',async()=>{const s=await setup();await expect(synchronizeApprovedAction({...s.input,task:{...s.input.task,project_id:2113514}},s.connector,s.ledger)).rejects.toThrow(/QTW/);expect(s.ledger.claim).not.toHaveBeenCalled();expect(s.connector.createTask).not.toHaveBeenCalled();});
it('does not reuse a ledger task from a different destination',async()=>{const s=await setup();vi.mocked(s.ledger.claim).mockResolvedValue({state:'done',task:{id:8,projectId:2113514,listId:6673813,url:'https://redbooth.com/a/#!/projects/2113514/tasks/8',status:'new'}});await expect(synchronizeApprovedAction(s.input,s.connector,s.ledger)).rejects.toThrow(/QTW/);expect(s.connector.createTask).not.toHaveBeenCalled();});
it('rejects a remote response in a different list and marks reconciliation pending',async()=>{const s=await setup();vi.mocked(s.connector.createTask).mockResolvedValue({id:9,projectId:2233821,listId:1,url:'https://redbooth.com/a/#!/projects/2233821/tasks/9',status:'new'});await expect(synchronizeApprovedAction(s.input,s.connector,s.ledger)).rejects.toThrow(/destino/);expect(s.ledger.uncertain).toHaveBeenCalledOnce();expect(s.ledger.complete).not.toHaveBeenCalled();});

it('can reserve a confirmed parent before children without PDF capability',async()=>{
 const {input,connector}=await setup();const states=new Map<string,{state:"done";task:Awaited<ReturnType<typeof connector.createTask>>}>();
 const ledger:SyncLedger={claim:async key=>states.get(key)??{state:"new"},created:async()=>{},complete:async(key,result)=>{states.set(key,{state:"done",task:result.task});},uncertain:async()=>{}};
 const transport={...connector,createSubtask:vi.fn(async()=>({...await connector.getTask(10),id:10}))};
 const parent={...input,planId:"principal",pdf:undefined};const child={...input,pdf:undefined};
 await synchronizeApprovedPlan(parent,[child],transport,ledger);
 await synchronizeApprovedPlan(parent,[child],transport,ledger);
 expect(transport.createTask).toHaveBeenCalledTimes(1);expect(transport.createSubtask).toHaveBeenCalledTimes(1);
 expect(transport.createSubtask.mock.calls[0]).toEqual([expect.objectContaining({id:9}),child.task,expect.stringContaining("org-a:case:plan")]);
});
