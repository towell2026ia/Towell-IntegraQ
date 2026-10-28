'use client';
import {useCallback,useEffect,useState} from 'react';
import {quarters,type Quarter} from '@/lib/indicator-data';
import {buildDefaultCaptureWindows,businessDateBoundary,formatBusinessDateInput,formatBusinessWindow} from '@/lib/indicators/indicator-windows';
import {captureRequest,type CapturePreview,type CaptureScope} from '@/lib/indicators/capture-global';
type History={id:string;kind:string;reason:string;created_at:string;restored_from:string|null};
type Review={preview:CapturePreview;kind:'global'|'restore';operationId:string};
const currentYear=()=>Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'America/Mexico_City'}).format(new Date()));
export function IndicatorCaptureSettings({onChanged,connected=true}:{onChanged:()=>Promise<void>;connected?:boolean}){
  const [year,setYear]=useState(currentYear);const [windows,setWindows]=useState(()=>buildDefaultCaptureWindows(currentYear()));
  const [selected,setSelected]=useState<Quarter[]>([...quarters]);const [includeExceptions,setIncludeExceptions]=useState(false);
  const [reason,setReason]=useState('');const [confirmed,setConfirmed]=useState(false);const [individualConfirmed,setIndividualConfirmed]=useState(false);const [review,setReview]=useState<Review|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');const [history,setHistory]=useState<History[]>([]);const [individual,setIndividual]=useState('');
  const refreshHistory=useCallback(async()=>{if(!connected)return;const r=await fetch('/api/indicators/capture-windows',{cache:'no-store'});if(r.ok)setHistory((await r.json()).history);},[connected]);
  useEffect(()=>{const timer=setTimeout(()=>void refreshHistory().catch(()=>setError('No fue posible consultar el historial.')),0);return()=>clearTimeout(timer);},[refreshHistory]);
  const invalidate=()=>{setReview(null);setConfirmed(false);setIndividualConfirmed(false);setIndividual('');setMessage('');};
  const scope:CaptureScope[]=selected.map(quarter=>({year,quarter,...windows[quarter]}));
  async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'No fue posible completar la operación.');}finally{setBusy(false);}}
  async function changed(){setReview(null);setConfirmed(false);setIndividualConfirmed(false);setIndividual('');await onChanged();await refreshHistory();window.dispatchEvent(new Event('indicator-capture-changed'));}
  const canWrite=connected&&!busy&&!!review&&confirmed&&reason.trim().length>0;
  return <section className='indicator-workspace-panel indicator-catalog-panel'>
    <header><p className='module-kicker'>Configuración → Indicadores</p><h2>Fechas de captura</h2><p>America/Mexico_City · Por defecto, del día 1 al 15 después del cierre trimestral. Los cambios conservan resultados y evidencias.</p></header>
    {!connected?<p role='alert'>Inicia una sesión conectada para administrar las ventanas.</p>:null}
    {error?<p className='form-error' role='alert'>{error}</p>:null}{message?<p role='status'>{message}</p>:null}
    <fieldset disabled={busy||!connected}><legend>Periodos que se actualizarán</legend>
      <label>Año <input type='number' min={2020} max={2200} value={year} onChange={e=>{const n=Number(e.target.value);setYear(n);if(Number.isInteger(n)&&n>=2020&&n<=2200)setWindows(buildDefaultCaptureWindows(n));invalidate();}}/></label>
      {quarters.map(q=><div className='indicator-catalog-search' key={q}><label><input type='checkbox' checked={selected.includes(q)} onChange={e=>{setSelected(p=>e.target.checked?[...p,q]:p.filter(v=>v!==q));invalidate();}}/>{q}</label>
        <label>Apertura <input aria-label={`Apertura ${q}`} type='date' value={formatBusinessDateInput(windows[q].opensAt)} onChange={e=>{if(e.target.value){setWindows(p=>({...p,[q]:{...p[q],opensAt:businessDateBoundary(e.target.value,'start')}}));invalidate();}}}/></label>
        <label>Cierre <input aria-label={`Cierre ${q}`} type='date' value={formatBusinessDateInput(windows[q].closesAt)} onChange={e=>{if(e.target.value){setWindows(p=>({...p,[q]:{...p[q],closesAt:businessDateBoundary(e.target.value,'end')}}));invalidate();}}}/></label></div>)}
      <label><input type='checkbox' checked={includeExceptions} onChange={e=>{setIncludeExceptions(e.target.checked);invalidate();}}/> Reemplazar también las excepciones individuales de los periodos seleccionados</label>
    </fieldset>
    <button className='button button-secondary' type='button' disabled={!connected||busy||selected.length===0} onClick={()=>void run(async()=>{const r=await captureRequest<{preview:CapturePreview}>({action:'preview',scope,includeExceptions});setReview({preview:r.preview,kind:'global',operationId:crypto.randomUUID()});setConfirmed(false);setIndividualConfirmed(false);setIndividual('');setMessage('');})}>Vista previa de Aplicar a todos</button>
    {review?<section aria-label='Vista previa de fechas de captura'><h3>{review.kind==='restore'?'Restaurar cambio anterior':'Aplicar a todos los indicadores'}</h3>
      <p>{review.preview.indicators} indicadores · {review.preview.windows} ventanas afectadas · {review.preview.exceptions} excepciones preservadas</p>
      <div style={{overflowX:'auto',maxHeight:420}}><table><thead><tr><th>Indicador</th><th>Periodo</th><th>Regla actual</th><th>Antes</th><th>Después</th></tr></thead><tbody>
        {review.preview.rows.map(r=><tr key={`${r.indicatorId}:${r.year}:${r.quarter}`}><td>{r.code} · {r.name}</td><td>{r.year} {r.quarter}</td><td>{r.source==='exception'?`Excepción: ${r.exceptionReason}`:r.source==='legacy'?'Ventana existente':'Regla global'}</td><td>{r.opensBefore&&r.closesBefore?formatBusinessWindow({opensAt:r.opensBefore,closesAt:r.closesBefore}):'Periodo nuevo'}</td><td>{r.preserved?'Se conserva la excepción':formatBusinessWindow({opensAt:r.opensAfter,closesAt:r.closesAfter})}</td></tr>)}
      </tbody></table></div>
      <label>Motivo obligatorio<textarea maxLength={1000} required value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false);setIndividualConfirmed(false);}}/></label>
      <label><input type='checkbox' checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo el alcance mostrado y {review.kind==='restore'?'la restauración':'la aplicación a todos los indicadores seleccionados'}.</label>
      <button className='button button-primary' type='button' disabled={!canWrite} onClick={()=>void run(async()=>{
        await captureRequest({action:review.kind==='restore'?'restore':'apply',operationId:review.operationId,token:review.preview.token,scope:review.preview.scope,includeExceptions:review.preview.includeExceptions,reason,confirmed});
        setMessage(review.kind==='restore'?'Cambio restaurado y auditado.':'Ventanas globales actualizadas y auditadas.');await changed();
      })}>{review.kind==='restore'?'Restaurar cambio':'Aplicar a todos'}</button>
      {review.kind==='global'?<fieldset disabled={busy}><legend>Excepción individual explícita</legend><p>Selecciona una ventana existente. La excepción prevalece hasta volver a la regla global o reemplazarla expresamente.</p>
        <select aria-label='Ventana individual' value={individual} onChange={e=>{setIndividual(e.target.value);setConfirmed(false);setIndividualConfirmed(false);}}><option value=''>Seleccionar indicador y trimestre</option>{review.preview.rows.filter(r=>r.periodId).map(r=><option key={r.periodId!} value={r.periodId!}>{r.code} · {r.year} {r.quarter} · {r.source}</option>)}</select>
        <label><input type='checkbox' checked={individualConfirmed} onChange={e=>setIndividualConfirmed(e.target.checked)}/> Confirmo modificar únicamente la ventana individual seleccionada, con el motivo indicado.</label>
        {['exception','inherit'].map(mode=><button key={mode} className='button button-secondary' type='button' disabled={!connected||busy||!reason.trim()||!individualConfirmed||!individual} onClick={()=>void run(async()=>{
          const row=review.preview.rows.find(r=>r.periodId===individual)!;const window=review.preview.scope.find(s=>s.year===row.year&&s.quarter===row.quarter)!;
          await captureRequest({action:'exception',periodId:row.periodId,expected:row.updatedAt,operationId:crypto.randomUUID(),window,inherit:mode==='inherit',reason,confirmed:individualConfirmed});setMessage(mode==='inherit'?'La ventana vuelve a heredar la regla global.':'Excepción individual guardada con motivo e historial.');await changed();
        })}>{mode==='inherit'?'Volver a regla global':'Guardar excepción con estas fechas'}</button>)}
      </fieldset>:null}
    </section>:null}
    <section><h3>Historial protegido</h3>{history.length===0?<p>No hay operaciones registradas.</p>:null}{history.map(h=><article key={h.id}><strong>{h.kind} · {new Date(h.created_at).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})}</strong><p>{h.reason}</p>
      {h.kind==='global'&&!history.some(r=>r.restored_from===h.id)?<button type='button' className='button button-secondary' disabled={!connected||busy} onClick={()=>void run(async()=>{const r=await captureRequest<{preview:CapturePreview}>({action:'restore_preview',operationId:h.id});setReview({kind:'restore',operationId:h.id,preview:r.preview});setReason('');setConfirmed(false);setIndividualConfirmed(false);setMessage('');})}>Vista previa de restauración</button>:null}
    </article>)}</section>
  </section>;
}
