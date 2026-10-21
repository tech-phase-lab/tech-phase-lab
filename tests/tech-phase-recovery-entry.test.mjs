import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const entry=readFileSync(new URL('../scripts/tech-phase/billing-recovery-entry.mjs',import.meta.url),'utf8');
function run(recover){
 const code=entry.replace(/^import .*;\n/,`const runSandboxRecovery=async()=>{${recover}};\n`);
 return spawnSync(process.execPath,['--input-type=module','-'],{input:code,encoding:'utf8',env:{PATH:process.env.PATH}});
}
test('a successfully reconciled held payment remains visible without hourly crash alerts',()=>{
 const r=run("return {outcome:'review-required',plan:'pro',state:'cancelled',changed:false}");
 assert.equal(r.status,0);
 assert.equal(JSON.parse(r.stdout).outcome,'review-required');
 assert.deepEqual(JSON.parse(r.stderr),{event:'TECH_PHASE_SANDBOX_REVIEW_REQUIRED',changed:false});
});
test('failed reconciliation still exits unsuccessfully and redacts the error',()=>{
 const r=run("throw Error('private-provider-token')");
 assert.equal(r.status,1);
 assert.deepEqual(JSON.parse(r.stderr),{event:'TECH_PHASE_SANDBOX_RECOVERY_FAILED'});
 assert.doesNotMatch(r.stdout+r.stderr,/private-provider-token/);
});
test('verified reconciliation emits no review warning',()=>{
 const r=run("return {outcome:'verified',plan:'pro',state:'active',changed:false}");
 assert.equal(r.status,0);assert.equal(r.stderr,'');
 assert.equal(JSON.parse(r.stdout).outcome,'verified');
});

test('cohort review holds are successful while actual partial failures remain visible',()=>{
 const held=run("return {outcome:'completed',reviewRequired:1,failed:0,unprocessed:0}");
 assert.equal(held.status,0);
 assert.deepEqual(JSON.parse(held.stderr),{event:'TECH_PHASE_SANDBOX_REVIEW_REQUIRED',count:1});
 for(const counts of [{failed:1,unprocessed:0},{failed:0,unprocessed:1}]) {
  const failed=run(`return ${JSON.stringify({outcome:'partial-failure',reviewRequired:0,...counts})}`);
  assert.equal(failed.status,1);assert.equal(failed.stderr,'');
 }
});
