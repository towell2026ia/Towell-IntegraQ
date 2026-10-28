import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {recoveryPreview,validateCaptureScope,type CapturePreview} from '@/lib/indicators/capture-global';
export const dynamic='force-dynamic';
async function context(){
  const db=await createClient();const auth=await db.auth.getUser();
  if(auth.error||!auth.data.user)return {response:NextResponse.json({error:'Sesión requerida.'},{status:401})};
  const p=await db.from('profiles').select('organization_id,workspace_mode,user_type,status').eq('id',auth.data.user.id).single();
  if(p.error||p.data.status!=='active'||p.data.user_type!=='administrator'||!p.data.organization_id||(auth.data.user.app_metadata.workspace_mode??'production')!==p.data.workspace_mode)return {response:NextResponse.json({error:'Se requiere un administrador del espacio activo.'},{status:403})};
  return {db,profile:p.data};
}
function failed(e:unknown){
  const error=e as {message?:string;code?:string};const code=error.message??'';
  const status=error.code==='42501'?403:/STALE|CONFLICT/.test(code)?409:/INVALID|DUPLICATE|REQUIRED|NOT_FOUND|NO_INDICATORS/.test(code)?400:500;
  return NextResponse.json({error:status===409?'La configuración cambió. Genera una nueva vista previa; no se aplicó el cambio.':status===403?'No tienes autorización para esta operación.':status===400?'Revisa los periodos, el motivo y la confirmación.':'No fue posible completar la operación. No se confirmó ningún cambio.'},{status});
}
export async function GET(){try{
  const c=await context();if(c.response)return c.response;
  const history=await c.db.from('indicator_capture_operations').select('id,kind,reason,scope,created_at,restored_from').eq('organization_id',c.profile.organization_id).eq('workspace_mode',c.profile.workspace_mode).order('created_at',{ascending:false}).limit(20);
  if(history.error)return failed(history.error);return NextResponse.json({history:history.data});
}catch(e){return failed(e);}}
export async function POST(request:Request){try{
  const origin=request.headers.get('origin');if(origin!==new URL(request.url).origin)return NextResponse.json({error:'Origen no autorizado.'},{status:403});
  const c=await context();if(c.response)return c.response;
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object')return NextResponse.json({error:'Solicitud inválida.'},{status:400});
  if(body.action==='preview'||body.action==='apply'){
    if(!validateCaptureScope(body.scope)||typeof body.includeExceptions!=='boolean')return NextResponse.json({error:'Ventanas inválidas.'},{status:400});
    if(body.action==='preview'){
      const r=await c.db.rpc('preview_indicator_capture_windows',{p_scope:body.scope,p_include_exceptions:body.includeExceptions});if(r.error)return failed(r.error);return NextResponse.json({preview:r.data});
    }
  }
  if(body.action==='restore_preview'){
    if(typeof body.operationId!=='string')return NextResponse.json({error:'Operación requerida.'},{status:400});
    const op=await c.db.from('indicator_capture_operations').select('scope,include_exceptions,before_preview,after_preview').eq('id',body.operationId).eq('kind','global').eq('organization_id',c.profile.organization_id).eq('workspace_mode',c.profile.workspace_mode).single();
    if(op.error)return failed(op.error);
    const p=await c.db.rpc('preview_indicator_capture_windows',{p_scope:op.data.scope,p_include_exceptions:op.data.include_exceptions});if(p.error)return failed(p.error);
    if(p.data.token!==op.data.after_preview.token)return failed({message:'CAPTURE_RECOVERY_CONFLICT'});
    return NextResponse.json({preview:recoveryPreview(op.data.before_preview as CapturePreview,p.data as CapturePreview)});
  }
  if(body.confirmed!==true||typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>1000)return NextResponse.json({error:'Confirma la operación e indica un motivo de hasta 1000 caracteres.'},{status:400});
  let name:string;let args:Record<string,unknown>;
  if(body.action==='apply'&&typeof body.token==='string'&&isUuid(body.operationId)){
    name='apply_indicator_capture_windows';args={p_scope:body.scope,p_include_exceptions:body.includeExceptions,p_token:body.token,p_operation:body.operationId,p_reason:body.reason.trim(),p_confirmed:true};
  }else if(body.action==='restore'&&isUuid(body.operationId)&&typeof body.token==='string'){
    name='restore_indicator_capture_windows';args={p_operation:body.operationId,p_token:body.token,p_reason:body.reason.trim(),p_confirmed:true};
  }else if(body.action==='exception'&&isUuid(body.periodId)&&isUuid(body.operationId)&&typeof body.expected==='string'&&Number.isFinite(Date.parse(body.expected))&&typeof body.inherit==='boolean'&&(body.inherit||validateCaptureScope([body.window]))){
    name='set_indicator_capture_exception';args={p_period:body.periodId,p_expected:body.expected,p_opens:body.inherit?null:body.window.opensAt,p_closes:body.inherit?null:body.window.closesAt,p_inherit:body.inherit,p_reason:body.reason.trim(),p_confirmed:true,p_operation:body.operationId};
  }else return NextResponse.json({error:'Operación inválida.'},{status:400});
  const r=await c.db.rpc(name,args);if(r.error)return failed(r.error);return NextResponse.json(r.data);
}catch(e){return failed(e);}}
function isUuid(v:unknown):v is string{return typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);}
