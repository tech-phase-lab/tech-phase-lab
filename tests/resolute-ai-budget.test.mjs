import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {monthlyAiLimit,serializeBudgetedRequest,reserveAiSpend} from '../services/resolute-api/ai-budget.mjs';
import {createRizelRanker} from '../services/resolute-api/rizel-ranker.mjs';

test('budget configuration and request bounds fail closed',()=>{
 for(const value of [undefined,'','NaN','-1','0','5.01','10','5e0'])assert.throws(()=>monthlyAiLimit(value));
 assert.equal(monthlyAiLimit('5.00'),5);
 const request={model:'gpt-5.4-mini',max_output_tokens:1800,input:'news'};
 assert.ok(serializeBudgetedRequest(request));
 for(const change of [{model:'other'},{max_output_tokens:1801},{tools:[{type:'web_search'}]},{input:'あ'.repeat(22000)},{service_tier:'priority'}])assert.throws(()=>serializeBudgetedRequest({...request,...change}));
});
test('concurrent summaries and selections share five dollars; failures stay charged; settlement is once only',async()=>{
 const saved=process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD;process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD='5.00';
 const pool=new PGlite(),now=new Date('2026-10-31T14:59:00Z');
 try{
  await pool.exec('CREATE SCHEMA resolute; CREATE TABLE resolute.risk_budget(month text PRIMARY KEY,reserved_usd numeric(8,4) NOT NULL CHECK(reserved_usd>=0))');
  const results=await Promise.allSettled(Array.from({length:70},()=>reserveAiSpend(pool,now)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,50);
  assert.equal(Number((await pool.query('SELECT reserved_usd FROM resolute.risk_budget')).rows[0].reserved_usd),5);
  const settle=results.find(r=>r.status==='fulfilled').value;
  await settle({input_tokens:1000,output_tokens:100});await settle({input_tokens:1000,output_tokens:100});
  assert.equal(Number((await pool.query('SELECT reserved_usd FROM resolute.risk_budget')).rows[0].reserved_usd),4.9012);
  await assert.rejects(reserveAiSpend(pool,now),/BUDGET_LIMIT/);
  // A JST month transition opens a separate bucket, without releasing October.
  await reserveAiSpend(pool,new Date('2026-10-31T15:00:00Z'));
  assert.equal((await pool.query('SELECT month FROM resolute.risk_budget ORDER BY month')).rows[1].month,'2026-11');
  const failed=results.filter(r=>r.status==='fulfilled')[1].value;
  await failed(undefined);await failed({input_tokens:1,output_tokens:1});
  assert.equal(Number((await pool.query("SELECT reserved_usd FROM resolute.risk_budget WHERE month='2026-10'")).rows[0].reserved_usd),4.9012);
  let calls=0;const rank=createRizelRanker({apiKey:'synthetic',pool:{query:async()=>({rows:[]})},fetchImpl:async()=>{calls++;}});
  await assert.rejects(rank({article:'test',candidates:[]}),/BUDGET_LIMIT/);assert.equal(calls,0);
 }finally{await pool.close();if(saved===undefined)delete process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD;else process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD=saved;}
});
