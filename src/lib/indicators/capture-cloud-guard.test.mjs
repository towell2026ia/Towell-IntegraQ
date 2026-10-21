import {describe,it,expect} from 'vitest';
import {assertCloud,selectPreview,parentProject} from '../../../scripts/ci/indicator-global-preview.mjs';
const branch='codex/stb-01-test';const good={git_branch:branch,project_ref:'abcdefghijklmnopqrst',parent_project_ref:parentProject,is_default:false,persistent:false};
describe('cloud-only Preview gate safeguards',()=>{
  it('rejects local execution before reading credentials or making a request',()=>{expect(()=>assertCloud({})).toThrow('CLOUD_HOSTED_PREVIEW_ONLY');expect(()=>assertCloud({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'self-hosted',RUNNER_OS:'Linux',STB_GIT_BRANCH:branch})).toThrow();});
  it('accepts only a GitHub hosted Linux runner on the STB branch',()=>{expect(()=>assertCloud({GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',STB_GIT_BRANCH:branch})).not.toThrow();});
  it('resolves only the unique ephemeral branch belonging to this PR',()=>expect(selectPreview([good],branch)).toBe(good.project_ref));
  it.each([{project_ref:parentProject},{is_default:true},{persistent:true},{git_branch:'main'},{parent_project_ref:'other'}])('rejects production or unrelated branches: %j',change=>expect(()=>selectPreview([{...good,...change}],branch)).toThrow());
  it('rejects ambiguous branch discovery',()=>expect(()=>selectPreview([good,good],branch)).toThrow());
});
