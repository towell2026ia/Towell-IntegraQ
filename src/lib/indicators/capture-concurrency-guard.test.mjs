import {describe,it,expect} from 'vitest';
import {requireOverlap,safeFailure,runCloud} from '../../../scripts/ci/indicator-concurrency-preview.mjs';
import {validateScope} from '../../../scripts/ci/indicator-concurrency-sql.mjs';
const a={pid:101,authenticated:true,started:'2026-10-22T00:00:00Z',ended:'2026-10-22T00:00:04Z'};
const b={pid:102,authenticated:true,started:'2026-10-22T00:00:01Z',ended:'2026-10-22T00:00:05Z'};
describe('real multi-session concurrency acceptance safeguards',()=>{
  it('accepts only distinct authenticated overlapping transactions',()=>expect(()=>requireOverlap(a,b)).not.toThrow());
  it('rejects sequential calls even when their backend IDs differ',()=>expect(()=>requireOverlap(a,{...b,started:'2026-10-22T00:00:05Z',ended:'2026-10-22T00:00:06Z'})).toThrow('CONCURRENCY_TRANSACTIONS_DID_NOT_OVERLAP'));
  it('rejects reuse of one database backend or unauthenticated actors',()=>{expect(()=>requireOverlap(a,{...b,pid:101})).toThrow('CONCURRENCY_SESSIONS_NOT_INDEPENDENT');expect(()=>requireOverlap(a,{...b,authenticated:false})).toThrow('CONCURRENCY_SESSIONS_NOT_AUTHENTICATED');});
  it('rejects local execution before any credentials or requests',async()=>await expect(runCloud({})).rejects.toThrow('CLOUD_HOSTED_PREVIEW_ONLY'));
  it('allows only generated fixture scopes and rejects identifier injection',()=>{
    const run='00000000-0000-0000-0000-000000000001';const c={run,org:'00000000-0000-0000-0000-000000000002',users:[3,4,5].map(n=>`00000000-0000-0000-0000-00000000000${n}`),schema:`stb_ms_${run.replaceAll('-','')}`,process:`STB-MS-${run}`};
    expect(validateScope(c)).toBe(c);expect(()=>validateScope({...c,schema:'public'})).toThrow('CONCURRENCY_SCOPE_INVALID');expect(()=>validateScope({...c,process:'existing-process'})).toThrow();expect(()=>validateScope({...c,users:[...c.users,c.users[0]]})).toThrow();
  });
  it('reports only safe failure codes and SQLSTATE, never arbitrary SQL text',()=>{
    expect(safeFailure('C4',{sqlstate:'42501',code:'INDICATOR_CAPTURE_WINDOW_CLOSED',message:'select private data',query:'credential'})).toEqual({scenario:'C4',sqlstate:'42501',code:'INDICATOR_CAPTURE_WINDOW_CLOSED'});
    expect(JSON.stringify(safeFailure('private_value',{sqlstate:'private_token',code:'credential',message:'private SQL'}))).not.toMatch(/private|credential/);
  });
});
