import {beforeEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import type {ActiveSession} from '@/lib/session-data';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({client:vi.fn(),download:vi.fn(),destroy:vi.fn(),pdf:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:m.client}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs',()=>({getDocument:m.pdf}));
import {retrieveRootCauseDocuments} from './context-server';
const session={authUserId:'actor',userType:'Usuario interno',assignedProcessIds:['P-08']} as ActiveSession;
let profiles:unknown[],versions:unknown[],file:Record<string,unknown>,versionError:unknown;
let calls:{table:string;method:string;args:unknown[]}[];
const document={id:'doc',code:'P-08-01',title:'Control',process_id:'P-08',active:true,organization_id:'org-a',deleted_at:null as string|null,document_type_id:'procedure'};
const bytes=new TextEncoder().encode('Medir tensión del tejido y registrar defectos.');
function from(table:string){
 const q:Record<string,unknown>={};
 for(const method of ['select','eq','not','is','order','limit'])q[method]=(...args:unknown[])=>{calls.push({table,method,args});return q;};
 const result=()=>table==='profiles'?{data:profiles.shift(),error:null}:table==='controlled_document_versions'?{data:versions,error:versionError}:{data:file,error:null};
 q.single=async()=>result();q.maybeSingle=async()=>result();
 q.then=(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve(result()).then(resolve,reject);
 return q;
}
beforeEach(()=>{vi.clearAllMocks();profiles=[{organization_id:'org-a',status:'active'}];document.organization_id='org-a';document.active=true;document.deleted_at=null;versions=[{id:'version',revision:'V1',file_id:'file',document}];versionError=null;file={id:'file',bucket_id:'integraq-private',object_path:'private/path',mime_type:'text/plain',size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};calls=[];m.client.mockResolvedValue({from,storage:{from:()=>({download:m.download})}});m.download.mockResolvedValue({data:new Blob([bytes]),error:null});});
it('rejects an external user before consulting data',async()=>{await expect(retrieveRootCauseDocuments({...session,userType:'Proveedor'},'P-08','tejido')).rejects.toThrow();expect(m.client).not.toHaveBeenCalled();});
it('rejects an unassigned process before consulting data',async()=>{await expect(retrieveRootCauseDocuments(session,'P-09','tejido')).rejects.toThrow();expect(m.client).not.toHaveBeenCalled();});
it('rejects an inactive internal actor',async()=>{profiles[0]={organization_id:'org-a',status:'inactive'};await expect(retrieveRootCauseDocuments(session,'P-08','tejido')).rejects.toThrow(/Organización/);expect(m.download).not.toHaveBeenCalled();});
it('selects only current approved documents from the requested process',async()=>{const r=await retrieveRootCauseDocuments(session,'P-08','tejido');expect(r.documents[0]).toMatchObject({id:'doc',version:'V1',excerpt:expect.stringContaining('Medir tensión')});expect(calls).toEqual(expect.arrayContaining([{table:'controlled_document_versions',method:'eq',args:['status','current']},{table:'controlled_document_versions',method:'not',args:['authorized_at','is',null]},{table:'controlled_document_versions',method:'eq',args:['document.process_id','P-08']} ]));});
it('does not download a document owned by another organization',async()=>{document.organization_id='org-b';expect((await retrieveRootCauseDocuments(session,'P-08','tejido')).documents).toEqual([]);expect(m.download).not.toHaveBeenCalled();});
it('does not use public buckets',async()=>{file.bucket_id='public';expect((await retrieveRootCauseDocuments(session,'P-08','tejido')).documents).toEqual([]);expect(m.download).not.toHaveBeenCalled();});
it('rejects mismatched SHA or length',async()=>{file.sha256='0'.repeat(64);expect((await retrieveRootCauseDocuments(session,'P-08','tejido')).documents).toEqual([]);profiles=[{organization_id:'org-a',status:'active'}];document.organization_id='org-a';document.active=true;document.deleted_at=null;file.sha256=null;file.size_bytes=bytes.length+1;expect((await retrieveRootCauseDocuments(session,'P-08','tejido')).documents).toEqual([]);});
it('does not fabricate an excerpt after a storage denial',async()=>{m.download.mockResolvedValue({data:null,error:{message:'denied'}});const r=await retrieveRootCauseDocuments(session,'P-08','tejido');expect(r.documents).toEqual([]);expect(r.warnings.join(' ')).toContain('Sin documentos');});
it('fails closed on document query errors',async()=>{versionError={message:'denied'};await expect(retrieveRootCauseDocuments(session,'P-08','tejido')).rejects.toThrow();expect(m.download).not.toHaveBeenCalled();});
it('skips files exceeding the extraction budget before downloading',async()=>{file.size_bytes=9*1024*1024;expect((await retrieveRootCauseDocuments(session,'P-08','tejido')).documents).toEqual([]);expect(m.download).not.toHaveBeenCalled();});
it('extracts PDF through the installed loading-task API and releases it',async()=>{const pdfBytes=new TextEncoder().encode('%PDF-local-memory-fixture');file={...file,mime_type:'application/pdf',size_bytes:pdfBytes.length,sha256:createHash('sha256').update(pdfBytes).digest('hex')};m.download.mockResolvedValue({data:new Blob([pdfBytes]),error:null});m.pdf.mockReturnValue({promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[{str:'Medir tensión del tejido'}]})})}),destroy:m.destroy});expect((await retrieveRootCauseDocuments(session,'P-08','tejido')).documents).toHaveLength(1);expect(m.destroy).toHaveBeenCalledOnce();});

it('rejects a same-creator document assigned to another organization',async()=>{document.organization_id='org-b';expect((await retrieveRootCauseDocuments(session,'P-08','tejido')).documents).toEqual([]);expect(m.download).not.toHaveBeenCalled();});
it('rejects withdrawn documents even if a version was formerly current',async()=>{document.deleted_at='2026-01-01';expect((await retrieveRootCauseDocuments(session,'P-08','tejido')).documents).toEqual([]);expect(m.download).not.toHaveBeenCalled();});
