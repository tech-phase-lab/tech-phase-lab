import test from 'node:test';
import assert from 'node:assert/strict';
import {readerConnection,verifyReader} from '../scripts/resolute/verify-reader.mjs';

const valid={current_user:'resolute_api_reader',current_database:'resolute',read_only:'on',
 can_read:true,can_write:false,can_create:false,elevated:false,fixtures:0};

test('completed provisioning is verified repeatedly with SELECT only',async()=>{
 const queries=[];
 const client={query:async(sql)=>{queries.push(sql);return {rows:[valid]};}};
 for(let i=0;i<2;i++)assert.equal((await verifyReader(client)).writes,0);
 assert.equal(queries.length,4);
 assert.ok(queries.every(sql=>sql.startsWith('SELECT ')));
});

test('verification rejects elevated roles, writable tables and unrolled fixtures',async()=>{
 for(const change of [{can_write:true},{can_create:true},{elevated:true},{fixtures:1},
  {read_only:'off'},{current_database:'other'},{current_user:'postgres'},{can_read:false}]){
  const client={query:async()=>({rows:[{...valid,...change}]})};
  await assert.rejects(verifyReader(client),/Reader verification failed/);
 }
});

test('verification connects as reader and refuses other database scopes',()=>{
 const env={RESOLUTE_SETUP_DB_URL:'postgresql://postgres:owner@postgres.railway.internal/resolute',
  RESOLUTE_READER_PASSWORD:'a'.repeat(64)};
 const url=new URL(readerConnection(env).connectionString);
 assert.equal(url.username,'resolute_api_reader');assert.equal(url.password,env.RESOLUTE_READER_PASSWORD);
 for(const raw of ['postgresql://postgres@public.example/resolute','postgresql://postgres@postgres.railway.internal/other']){
  assert.throws(()=>readerConnection({...env,RESOLUTE_SETUP_DB_URL:raw}),/Invalid verification scope/);
 }
});
