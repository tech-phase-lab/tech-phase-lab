import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewsReader} from '../services/resolute-api/rizel-news-source.mjs';
const token='synthetic-reader-token-for-tests-only-1234';
test('reader uses fixed GET path, rejects redirects, and sanitizes upstream previews',async()=>{
 const read=createNewsReader({origin:'https://monitor.example',token,fetcher:async(url,options)=>{
  assert.equal(url.href,'https://monitor.example/internal/resolute/news');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,`Bearer ${token}`);
  return Response.json({ok:true,enabled:false,items:[],officialUpdates:[],originalPreviewItems:[{secret:'must not survive'}]});
 }});
 const feed=await read();assert.equal(feed.ok,true);assert.equal(feed.enabled,false);assert.equal(feed.originalPreviewItems?.length??0,0);
});
test('source configuration and failures fail closed',async()=>{
 for(const origin of ['http://monitor.example','https://user:pass@monitor.example','https://monitor.example/other','https://monitor.example/?x=1'])assert.throws(()=>createNewsReader({origin,token}));
 assert.throws(()=>createNewsReader({origin:'https://monitor.example',token:''}));
 for(const response of [Response.json({ok:false},{status:503}),Response.json({ok:false}),new Response('x'.repeat(500001))]){
  await assert.rejects(createNewsReader({origin:'https://monitor.example',token,fetcher:async()=>response})());
 }
});
