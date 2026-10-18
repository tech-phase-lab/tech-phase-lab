import test from 'node:test';
import assert from 'node:assert/strict';
import {discover} from '../scripts/chain/discover.mjs';

const companies=[{id:'AAA',name:'Alpha Company',aliases:[],cik:1},{id:'BBB',name:'Beta Company',aliases:[],cik:2}];
const base={roots:['AAA'],profiles:[{tickers:['AAA'],cik:1,sources:[]}],universe:new Map(companies.map(c=>[c.id,c])),domains:{AAA:{domains:[{host:'alpha.example'}]},BBB:{domains:[{host:'beta.example'}]}},includePartners:false};
const page=(html,body='',date=null)=>({html,body,date,status:200});

test('SEC denial does not cancel other issuers or official news collection',async()=>{
 const calls=[];
 const result=await discover({...base,roots:['AAA','BBB'],get:async url=>{
  calls.push(url);
  if(url.includes('sec.gov'))return {status:429,error:'http_429'};
  return page('<a href="/news/contract">Partnership contract</a>');
 }});
 assert.deepEqual(result.stopReasons,[]);
 assert.equal(result.checks.filter(c=>c.error==='http_429').length,2);
 assert.ok(calls.includes('https://alpha.example/'));
 assert.ok(calls.includes('https://beta.example/'));
});

test('bounded archive resumes pending articles without admitting archive itself',async()=>{
 const get=async url=>url==='https://alpha.example/'?page('<a href="/news/one">Partner one</a><a href="/news/two">Partner two</a>','Alpha Company index','2026-01-01'):page('<article>Release</article>','Alpha Company partnership','2026-01-01');
 const first=await discover({...base,get,collectSec:false,limits:{articlePages:1}});
 assert.equal(first.documents.length,1);
 assert.notEqual(first.documents[0].url,'https://alpha.example/');
 assert.equal(first.coverage.AAA.newsroom.hasMore,true);
 const second=await discover({...base,get,collectSec:false,limits:{articlePages:1},resume:{AAA:first.coverage.AAA.newsroom.continuation}});
 assert.equal(second.documents.length,1);
 assert.notEqual(second.documents[0].url,first.documents[0].url);
 assert.equal(second.coverage.AAA.newsroom.hasMore,false);
 assert.equal(second.coverage.AAA.newsroom.complete,false);
});

test('source-named partner newsroom supplies independently published release',async()=>{
 const result=await discover({...base,includePartners:true,collectSec:false,get:async url=>{
  if(url.endsWith('/'))return page('<a href="/news/agreement">Supply agreement</a>');
  return page('<article>Agreement</article>','Alpha Company and Beta Company sign a supply agreement.','2026-01-01');
 }});
 assert.ok(result.documents.some(d=>d.issuer==='BBB'&&d.url.startsWith('https://beta.example/')));
 assert.equal(result.coverage.BBB.scope,'source_named_counterparty');
});

test('missing official registration is reported instead of a silent skip',async()=>{
 const result=await discover({...base,domains:{},collectSec:false,get:async()=>{throw Error('must not fetch unregistered sites')}});
 assert.equal(result.coverage.AAA.newsroom.reason,'official_domains_not_registered');
 assert.deepEqual(result.checks,[]);
});

test('archive pagination rejects old query years and last-page jumps',async()=>{
 const calls=[];
 const result=await discover({...base,collectSec:false,get:async url=>{
  calls.push(url);
  if(url==='https://alpha.example/')return page('<a href="/news">News</a>');
  if(url.endsWith('/news'))return page('<a href="/news?page=1" rel="next">Next</a><a href="/news?page=510">Last</a><a href="/news?year=2023">Archive</a>','January 1, 2026');
  return page('<a href="/news?page=2" rel="next">Next</a>','January 1, 2023');
 }});
 assert.ok(calls.includes('https://alpha.example/news?page=1'));
 assert.ok(!calls.some(url=>url.includes('510')||url.includes('2023')||url.includes('page=2')));
 assert.ok(result.coverage.AAA.newsroom.notes.includes('archive_before_window_frontier'));
});

test('identical pagination content terminates continuation',async()=>{
 const get=async url=>url.endsWith('/')?page('<a href="/news">News</a>'):page('<a href="/news/story">Partner story</a><a href="/news?page=1" rel="next">Next</a>','January 1, 2026','2026-01-01');
 const result=await discover({...base,get,collectSec:false});
 assert.equal(result.coverage.AAA.newsroom.hasMore,false);
 assert.ok(result.coverage.AAA.newsroom.notes.includes('repeated_archive_content_skipped'));
});

test('official dated headline, node and newsletter release URLs are discovered',async()=>{
 const get=async url=>url.endsWith('/')?page('<a href="/2026-10-01-Alpha-and-Beta">Alpha and Beta</a><a href="/node/1234">Supply contract</a><a href="/newsletter/contract">A contract</a>'):page('<article>Official announcement</article>','Alpha Company and Beta Company agree supply.','2026-10-01');
 const result=await discover({...base,get,collectSec:false});
 assert.equal(result.documents.length,3);
});

test('unrelated company name in another sentence does not trigger partner crawl',async()=>{
 const calls=[];
 const result=await discover({...base,includePartners:true,collectSec:false,get:async url=>{
  calls.push(url);return url.endsWith('/')?page('<a href="/news/launch">Launch</a>'):page('<article>Announcement</article>','Alpha Company launches new software. Beta Company is mentioned separately.','2026-10-01');
 }});
 assert.ok(!calls.some(url=>url.includes('beta.example')));
 assert.equal(result.coverage.BBB,undefined);
});

test('per-card dates skip old releases before fetching in a mixed archive',async()=>{
 const calls=[];
 const result=await discover({...base,collectSec:false,get:async url=>{
  calls.push(url);
  if(url==='https://alpha.example/')return page('<a href="/news">News</a>');
  if(url.endsWith('/news'))return page('<div class="listing"><h5><a href="/news/old">Old contract</a></h5><div class="blogdate">June 4, 2013</div></div><article class="card"><a href="/news/current">New contract</a><time datetime="2026-09-01">September 1, 2026</time></article>','September 1, 2026 June 4, 2013');
  return page('<article>Contract</article>','Alpha Company agreement.','2026-09-01');
 }});
 assert.ok(!calls.includes('https://alpha.example/news/old'));
 assert.ok(calls.includes('https://alpha.example/news/current'));
 assert.equal(result.documents.length,1);
});

test('old listing frontier ignores current featured content and blocks distant path pages',async()=>{
 const calls=[];
 const result=await discover({...base,collectSec:false,get:async url=>{
  calls.push(url);
  if(url==='https://alpha.example/')return page('<a href="/news">News</a>');
  if(url.endsWith('/news'))return page('<div class="listing"><a href="/news/current">New contract</a><div class="blogdate">October 1, 2026</div></div><a href="/news/page/2/">Load More</a><a href="/news/page/12/">Last</a>','October 1, 2026');
  if(url.endsWith('/page/2/'))return page('<section class="featured"><a href="/news/current">Featured</a><time datetime="2026-10-01">October 1, 2026</time></section><div class="listing"><h5><a href="/news/old">Old contract</a></h5><div class="blogdate">June 4, 2013</div></div><a href="/news/page/3/">Load More</a>','October 1, 2026 June 4, 2013','2026-10-01');
  return page('<article>Contract</article>','Alpha Company agreement.','2026-10-01');
 }});
 assert.ok(calls.includes('https://alpha.example/news/page/2/'));
 assert.ok(!calls.some(url=>url.endsWith('/page/3/')||url.endsWith('/page/12/')||url.endsWith('/news/old')));
 assert.ok(result.coverage.AAA.newsroom.notes.includes('archive_before_window_frontier'));
});
