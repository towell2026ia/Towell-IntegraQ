import {describe,it,expect} from 'vitest';
import {validateCaptureScope,recoveryPreview} from './capture-global';
import {buildDefaultCaptureWindows} from './indicator-windows';
import type {CapturePreview} from './capture-global';
const scope=[{year:2026,quarter:'Q4',...buildDefaultCaptureWindows(2026).Q4}];
describe('global capture scope and recovery',()=>{
  it('uses the next year and Mexico City boundaries for Q4',()=>{expect(validateCaptureScope(scope)).toBe(true);expect(scope[0].opensAt).toBe('2027-01-01T06:00:00.000Z');expect(scope[0].closesAt).toBe('2027-01-16T05:59:59.999Z');});
  it.each([[],[...scope,...scope],[{...scope[0],year:2019}],[{...scope[0],quarter:'Q5'}],[{...scope[0],opensAt:'2027-01-01'}],[{...scope[0],opensAt:'Infinity'}],[{...scope[0],opensAt:'2028-01-01T00:00:00Z'}]])('rejects an unsafe scope: %j',value=>expect(validateCaptureScope(value)).toBe(false));
  it('reviews recovery of all 52 windows without inventing prior rows',()=>{
    const rows=Array.from({length:52},(_,i)=>({indicatorId:`fixture-${i}`,code:`STB-${i}`,name:'Fixture',processId:'P-FIXTURE',year:2026,quarter:'Q4' as const,periodId:`period-${i}`,updatedAt:'2026-10-21T00:00:00Z',source:'global' as const,exceptionReason:null,opensBefore:scope[0].opensAt,closesBefore:scope[0].closesAt,opensAfter:'2027-01-02T06:00:00Z',closesAfter:'2027-01-20T06:00:00Z',preserved:false}));
    const before:CapturePreview={token:'before',scope:scope as CapturePreview['scope'],rows,rules:[],defaultDays:15,includeExceptions:false,indicators:52,windows:52,exceptions:0};
    const after:CapturePreview={...before,token:'after',rows:rows.map(r=>({...r,opensBefore:r.opensAfter,closesBefore:r.closesAfter}))};
    const restored=recoveryPreview(before,after);expect(restored.rows).toHaveLength(52);expect(restored.rows.every(r=>r.opensAfter===scope[0].opensAt&&r.closesAfter===scope[0].closesAt)).toBe(true);expect(restored.token).toBe('after');expect(after.rows[0].opensBefore).not.toBe(scope[0].opensAt);
  });
  it('refuses recovery when an indicator was added or removed',()=>{const p={rows:[],rules:[],defaultDays:15} as unknown as CapturePreview;expect(()=>recoveryPreview(p,{rows:[{indicatorId:'unexpected'}]} as CapturePreview)).toThrow('cambió');});
});
