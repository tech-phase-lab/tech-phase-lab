import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {rizelReviewRequest} from '../services/resolute-api/rizel-review-store.mjs';
import {OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
const post=v=>new Request('https://service/internal/v1/rizel/owner',{method:'POST',body:JSON.stringify(v)});
test('owner review: separate languages, optimistic concurrency, audit, withheld and stale protection',async()=>{
 const db=new PGlite();try{
 for(const file of ['011_rizel_selections.sql','012_rizel_review.sql'])await db.exec(await readFile(new URL('../db/resolute/'+file,import.meta.url),'utf8'));
 const pool={query:(s,a)=>db.query(s,a),connect:async()=>({query:(s,a)=>s.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(s,a),release(){}})};
 const denied=await rizelReviewRequest(new Request('https://test'),'not-owner',null,{query(){throw Error('must not read')}});assert.equal(denied.status,403);
 await db.query('INSERT INTO resolute_rizel_selections VALUES($1,$2,$3,$4)',['a','v1','2026-10-17T00:00:00Z',JSON.stringify({publication:'withheld',copy:[{ja:'Synthetic',en:'Synthetic'}]})]);
 await db.exec("INSERT INTO resolute_rizel_reviews(article_id,article_revision,locale) VALUES('a','v1','ja'),('a','v1','en')");
 const input={action:'review',articleId:'a',articleRevision:'v1',locale:'ja',baseRevision:0,decision:'approved'};
 assert.equal((await rizelReviewRequest(post(input),OWNER_ACCOUNT_ID,null,pool)).status,200);
 assert.equal((await rizelReviewRequest(post(input),OWNER_ACCOUNT_ID,null,pool)).status,409);
 const rows=(await db.query('SELECT * FROM resolute_rizel_reviews ORDER BY locale')).rows;assert.equal(rows[0].state,'pending');assert.equal(rows[1].state,'approved');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM resolute_rizel_review_events')).rows[0].n,1);
 assert.equal((await db.query('SELECT result FROM resolute_rizel_selections')).rows[0].result.publication,'withheld');
 await db.query('INSERT INTO resolute_rizel_selections VALUES($1,$2,$3,$4)',['a','v2','2026-10-17T01:00:00Z',JSON.stringify({publication:'withheld',copy:[{}]})]);
 assert.equal((await rizelReviewRequest(post({...input,locale:'en'}),OWNER_ACCOUNT_ID,null,pool)).status,409);
 for(const locale of ['ja','en'])await db.query("INSERT INTO resolute_rizel_copy_versions(id,locale,revision,value,approval) VALUES('A-reason-01',$1,1,$2,'approved')",[locale,JSON.stringify({text:'old',group:'A',kind:'reason'})]);
 assert.equal((await rizelReviewRequest(post({action:'approve-copy',id:'A-reason-01',locale:'ja',baseRevision:1,text:'New exact text'}),OWNER_ACCOUNT_ID,null,pool)).status,200);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM resolute_rizel_copy_versions WHERE locale='en'")).rows[0].n,1);
 const snapshot=await rizelReviewRequest(new Request('https://test'),OWNER_ACCOUNT_ID,null,pool);assert.equal(snapshot.status,200);assert.equal((await snapshot.json()).copies.length,1);
 assert.equal((await db.query("SELECT value FROM resolute_rizel_copy_versions WHERE locale='ja' AND revision=1")).rows[0].value.text,'old');
 }finally{await db.close();}
});
