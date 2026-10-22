import {describe,it,expect,vi} from 'vitest';
import {assertCloud,selectPreview,parentProject,previewBranch,createManagementClient,safeDiagnostic,assertFixtureResult,fixtureStages,fixtureDiagnostic,residueParameters} from '../../../scripts/ci/indicator-global-preview.mjs';
const branch=previewBranch;const good={git_branch:branch,pr_number:4,project_ref:'abcdefghijklmnopqrst',parent_project_ref:parentProject,is_default:false,persistent:false};
describe('cloud-only Preview gate safeguards',()=>{
  it('rejects local execution before reading credentials or making a request',()=>{expect(()=>assertCloud({})).toThrow('CLOUD_HOSTED_PREVIEW_ONLY');expect(()=>assertCloud({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted',RUNNER_OS:'Linux',STB_GIT_BRANCH:branch})).toThrow();});
  it('accepts only a GitHub hosted Linux runner on the STB branch',()=>{expect(()=>assertCloud({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',STB_GIT_BRANCH:branch})).not.toThrow();});
  it('resolves only the unique ephemeral branch belonging to this PR',()=>expect(selectPreview([good],branch,4)).toBe(good.project_ref));
  it.each([{project_ref:parentProject},{is_default:true},{persistent:true},{git_branch:'main'},{parent_project_ref:'other'},{pr_number:2},{pr_number:null}])('rejects production or unrelated branches: %j',change=>expect(()=>selectPreview([{...good,...change}],branch,4)).toThrow());
  it('rejects ambiguous branch discovery',()=>expect(()=>selectPreview([good,good],branch,4)).toThrow());
  it('rejects wrapped/malformed responses and a different requested PR',()=>{expect(()=>selectPreview({branches:[good]},branch,4)).toThrow('PREVIEW_BRANCH_RESPONSE_INVALID');expect(()=>selectPreview([good],branch,2)).toThrow('PREVIEW_PR_IDENTITY_INVALID');expect(()=>selectPreview([good],'codex/stb-01-other',4)).toThrow('PREVIEW_PR_IDENTITY_INVALID');});
  it('requires all real SQL stages, rollback and absence of residues for PASS',()=>{
    const report={status:'STB_01_PREVIEW_PASS',fixture_indicators:52,completed_stages:fixtureStages,rollback:true,residual_fixture_records:0,ambiguity_reproduced:true};
    expect(()=>assertFixtureResult({message:'STB_01_PREVIEW_PASS'})).toThrow();
    for(const change of [{fixture_indicators:51},{completed_stages:fixtureStages.slice(0,-1)},{rollback:false},{residual_fixture_records:1},{ambiguity_reproduced:false},{status:'STB_01_PREVIEW_FAIL'}])expect(()=>assertFixtureResult([{fixture_report:{...report,...change}}])).toThrow();
    expect(assertFixtureResult([{fixture_report:report}])).toEqual(report);
  });
  it('returns only stage, SQLSTATE, a trusted code and classification for SQL failures',()=>{
    const d=fixtureDiagnostic({failed_stage:fixtureStages[6],sqlstate:'42702',error_code:'private_value',message:'select secret',detail:'password'});
    expect(d).toEqual({stage:fixtureStages[6],sqlstate:'42702',errorCode:'SQL_AMBIGUOUS_REFERENCE',classification:'AMBIGUOUS_REFERENCE'});
    expect(fixtureDiagnostic({failed_stage:'private_stage',sqlstate:'secret',error_code:'STB_RESULTS_CHANGED'},new Set(['STB_RESULTS_CHANGED']))).toEqual({stage:'STB_00_SQL_ENVELOPE',sqlstate:'XXXXX',errorCode:'STB_RESULTS_CHANGED',classification:'SQL_EXECUTION'});
  });
  it('extracts SQLSTATE from a rejected SQL envelope without exposing its SQL or data',()=>{
    const d=safeDiagnostic('preview-transactional-fixtures','POST',new Response('',{status:400}),{message:'Failed to run sql query: ERROR: 42702: column reference "private_column" is ambiguous\nQUERY: select secret'});
    expect(d).toEqual({stage:'STB_00_SQL_ENVELOPE',sqlstate:'42702',errorCode:'SQL_ENVELOPE_FAILURE',classification:'AMBIGUOUS_REFERENCE'});
  });
  it('validates fixture identities before the independent parameterized residue request',()=>{
    const uuid='00000000-0000-0000-0000-000000000001';const report={fixture_organizations:[uuid,uuid],fixture_users:Array(5).fill(uuid),fixture_process:`STB-CI-${uuid}`};
    expect(residueParameters(report)).toEqual([report.fixture_organizations,report.fixture_users,report.fixture_process]);
    expect(()=>residueParameters({...report,fixture_process:'select private'})).toThrow('PREVIEW_RESIDUE_SCOPE_INVALID');
    expect(()=>residueParameters({...report,fixture_users:['secret']})).toThrow();
  });
  it('identifies an HTTP failure without logging SQL, credentials or response extras',async()=>{
    const token='fixture_secret_token';const query='select highly_sensitive_value from private_table';const log=vi.fn();
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({code:'BAD_REQUEST',message:`Invalid token ${token} Authorization: Bearer fixture_other_secret postgres://user:password@host/database ${query}\nLINE 1: ${query}`,detail:query,headers:{Authorization:token}}),{status:400,headers:{'x-request-id':'request-123'}}));
    await expect(createManagementClient(token,fetchMock,log)('preview-migration-readiness','/projects/preview/database/query/read-only',{query})).rejects.toThrow('SUPABASE_PREVIEW_HTTP_400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const diagnostic=JSON.parse(log.mock.calls[0][0]);
    expect(diagnostic).toMatchObject({endpoint:'preview-migration-readiness',method:'POST',status:400,errorCode:'BAD_REQUEST',requestId:'request-123'});
    for(const sensitive of [token,query,'Authorization','fixture_other_secret','user:password','highly_sensitive_value','private_table','LINE'])expect(log.mock.calls[0][0]).not.toContain(sensitive);
    expect(Object.keys(diagnostic).sort()).toEqual(['endpoint','method','status','errorCode','errorMessage','requestId'].sort());
  });
  it('keeps permission errors useful without trusting arbitrary response fields',()=>{
    const r=new Response('',{status:400,headers:{'x-request-id':'fixture_secret_token'}});
    const d=safeDiagnostic('list-preview-branches','GET',r,{code:'fixture_secret_token',message:'This endpoint is not supported for fine-grained access tokens'},'fixture_secret_token');
    expect(d.errorMessage).toBe('This endpoint is not supported for fine-grained access tokens');expect(d.errorCode).toBe('API_ERROR');expect(d).not.toHaveProperty('requestId');
  });
  it('accepts documented 200/201 JSON responses and logs no response content',async()=>{
    const log=vi.fn();const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify([good]),{status:200}));
    expect(await createManagementClient('fixture',fetchMock,log)('list-preview-branches',`/projects/${parentProject}/branches`)).toEqual([good]);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({endpoint:'list-preview-branches',method:'GET',status:200});
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ready:true}]),{status:201}));
    expect(await createManagementClient('fixture',fetchMock,log)('preview-migration-readiness','/preview',{query:'fixture'})).toEqual([{ready:true}]);
  });
  it('does not leak network exceptions or non-JSON errors',async()=>{
    const log=vi.fn();const fetchMock=vi.fn().mockRejectedValue(Error('secret credential'));
    await expect(createManagementClient('fixture',fetchMock,log)('list-preview-branches','/fixture')).rejects.toThrow('SUPABASE_PREVIEW_TRANSPORT_ERROR');expect(log).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(new Response('secret html',{status:400}));
    await expect(createManagementClient('fixture',fetchMock,log)('list-preview-branches','/fixture')).rejects.toThrow('SUPABASE_PREVIEW_HTTP_400');expect(log.mock.calls[0][0]).not.toContain('secret html');
  });
});
