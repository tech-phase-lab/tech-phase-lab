import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
test('server reader requires tool entitlement before opening storage; disabled never contacts auth/storage',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.gauge-access-'));
 const oldEnabled=process.env.RESOLUTE_THERMOMETER_READ_ENABLED,oldUrl=process.env.RESOLUTE_THERMOMETER_READ_DATABASE_URL;
 const state=globalThis.__gaugeAccess={configured:true,user:'user_test',token:'test-session',allowed:false,pools:0,reads:0,auths:0,ends:0};
 try {
 const outfile=join(dir,'reader.cjs');
 await build({entryPoints:['lib/resolute/thermometer-server.ts'],outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'isolated-access',setup(b){
 b.onResolve({filter:/^(server-only|pg|@clerk\/nextjs\/server|@\/lib\/membership\/server|\.\/server|\.\/thermometer-runtime)$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='server-only'?'':args.path==='pg'?'export class Pool {constructor(){globalThis.__gaugeAccess.pools++} async end(){globalThis.__gaugeAccess.ends++}}':args.path==='@clerk/nextjs/server'?'export async function auth(){const s=globalThis.__gaugeAccess;s.auths++;return {userId:s.user,getToken:async()=>s.token}}':args.path==='@/lib/membership/server'?'export const membershipConfigured=()=>globalThis.__gaugeAccess.configured;':args.path==='./server'?'export async function getResoluteEntitlementsForSession(token){if(token!=="test-session")throw Error("wrong token");return {canUseTools:globalThis.__gaugeAccess.allowed}}':'export async function readThermometer(){globalThis.__gaugeAccess.reads++;return {asOf:"fixture"}}',loader:'js'}));
 }}]});
 const {loadThermometerSnapshot}=createRequire(import.meta.url)(outfile);
 process.env.RESOLUTE_THERMOMETER_READ_ENABLED='0';process.env.RESOLUTE_THERMOMETER_READ_DATABASE_URL='fixture-only';
 assert.equal(await loadThermometerSnapshot(),undefined);assert.equal(state.auths,0);assert.equal(state.pools,0);
 process.env.RESOLUTE_THERMOMETER_READ_ENABLED='1';
 for(const patch of [{configured:false},{configured:true,user:null},{user:'user_test',token:null},{token:'test-session',allowed:false}]){
 Object.assign(state,patch);assert.equal(await loadThermometerSnapshot(),undefined);assert.equal(state.pools,0);
 }
 state.allowed=true;assert.deepEqual(await loadThermometerSnapshot(),{asOf:'fixture'});assert.equal(state.pools,1);assert.equal(state.reads,1);assert.equal(state.ends,1);
 state.token='invalid';assert.equal(await loadThermometerSnapshot(),undefined);assert.equal(state.pools,1);
 }finally{
 if(oldEnabled===undefined)delete process.env.RESOLUTE_THERMOMETER_READ_ENABLED;else process.env.RESOLUTE_THERMOMETER_READ_ENABLED=oldEnabled;
 if(oldUrl===undefined)delete process.env.RESOLUTE_THERMOMETER_READ_DATABASE_URL;else process.env.RESOLUTE_THERMOMETER_READ_DATABASE_URL=oldUrl;
 delete globalThis.__gaugeAccess;await rm(dir,{recursive:true,force:true});
 }
});
