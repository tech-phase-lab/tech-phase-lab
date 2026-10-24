import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { assertIsolatedEnvironment, createRecoveryExecutor } from '../services/resolute-recovery/executor.mjs';
import { createAcceptanceObjects } from '../services/resolute-recovery/storage.mjs';
const env={RECOVERY_STORAGE_ENDPOINT:'https://test.storageapi.dev',RECOVERY_STORAGE_BUCKET:'test',RECOVERY_STORAGE_REGION:'auto',RECOVERY_STORAGE_ACCESS_KEY_ID:'synthetic',RECOVERY_STORAGE_SECRET_ACCESS_KEY:'synthetic'};
const name='resolute/protection/events-v1/'+ 'a'.repeat(64)+'.bin';
test('executor rejects production environment before opening any resources',async()=>{
 assert.throws(()=>assertIsolatedEnvironment({}));
 for(const key of ['PGHOST','DATABASE_URL','RESOLUTE_PLAN_DB_URL','RESOLUTE_OPENAI_API_KEY','PAYPAL_SECRET','RESOLUTE_PROTECTION_KEY_HEX'])assert.throws(()=>assertIsolatedEnvironment({RESOLUTE_RECOVERY_ACCEPTANCE_ONLY:'true',[key]:'private'}));
 const execute=createRecoveryExecutor({config:{},objects:{},env:{RESOLUTE_RECOVERY_ACCEPTANCE_ONLY:'true'}});
 await assert.rejects(execute({userId:'user_other',signal:new AbortController().signal,authorization:'Bearer synthetic'}));
});
test('acceptance object storage forces unique namespace, conditional writes and bounded readback',async()=>{
 const calls=[],body=Buffer.alloc(40);
 const client={async send(command){calls.push(command.input);return {ContentLength:40,Body:Readable.from([body])};}};
 const a=createAcceptanceObjects(env,client),b=createAcceptanceObjects(env,client);
 await a.putIfAbsent(name,body);assert.deepEqual(await a.read(name),body);await b.putIfAbsent(name,body);
 assert.match(calls[0].Key,/^resolute\/protection\/acceptance\/[0-9a-f-]+\/[a-f0-9]{64}\.bin$/);
 assert.equal(calls[0].Key,calls[1].Key);assert.notEqual(calls[0].Key,calls[2].Key);assert.equal(calls[0].IfNoneMatch,'*');
 await assert.rejects(a.read('../production'));await assert.rejects(a.putIfAbsent(name,Buffer.alloc(2049)));assert.equal(calls.length,3);
});
test('truncated or oversized independent readback cannot be accepted',async()=>{
 for(const [size,actual] of [[40,39],[40,41],[2049,2049]]){
 const objects=createAcceptanceObjects(env,{async send(){return {ContentLength:size,Body:Readable.from([Buffer.alloc(actual)])};}});
 await assert.rejects(objects.read(name));
 }
});
test('acceptance CLI is disabled before requiring credentials or launching databases',()=>{
 const result=spawnSync(process.execPath,['--experimental-strip-types','services/resolute-recovery/cli.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH}});
 assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{event:'RESOLUTE_RECOVERY_ACCEPTANCE_DISABLED'});
});

test('owner runner stays closed without an explicit bounded single-instance configuration',async()=>{
 const {recoveryServerConfig}=await import('../services/resolute-recovery/server.mjs');
 assert.equal(recoveryServerConfig({}),null);
 for(const until of ['invalid',new Date(Date.now()-1000).toISOString(),new Date(Date.now()+7200000).toISOString()])
  assert.throws(()=>recoveryServerConfig({RESOLUTE_RECOVERY_CHECK_ENABLED:'true',RESOLUTE_RECOVERY_ACCEPTANCE_ONLY:'true',RESOLUTE_RECOVERY_SINGLE_INSTANCE:'true',RESOLUTE_RECOVERY_CHECK_UNTIL:until}));
 const result=spawnSync(process.execPath,['--experimental-strip-types','services/resolute-recovery/server.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH}});
 assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{event:'RESOLUTE_RECOVERY_SERVER_DISABLED'});
});
