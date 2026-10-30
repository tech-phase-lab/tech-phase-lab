import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import nextTesting from 'next/experimental/testing/server.js';
// Installed Next version retains the previous name for the proxy matcher helper.
const {unstable_doesMiddlewareMatch: unstable_doesProxyMatch} = nextTesting;

test('Clerk proxy supplies identity to research pages and membership APIs',()=>{
 const source=readFileSync(new URL('../proxy.ts',import.meta.url),'utf8');
 const matcher=JSON.parse(source.match(/matcher:\s*(\[[^\]]+\])/)[1]);
 const matches=url=>unstable_doesProxyMatch({config:{matcher},nextConfig:{},url});
 for(const url of ['/research/notes','/research/write','/research/companies/MU','/research/account','/research/account/sign-up','/api/research/member','/api/research/radar','/api/research/member/preview','/api/research/billing/sandbox/readiness','/api/research/billing/sandbox/create','/api/research/billing/sandbox/webhook','/api/research/articles/example','/api/research/notifications','/api/research/posts','/api/research/author','/api/research/editor-owner','/api/research/questions','/api/research/questions/moderation']) assert.equal(matches(url),true,url);
 for(const url of ['/api/research/editor','/api/research/news','/api/research/notifications/entitlement']) assert.equal(matches(url),false,url);
 // Public pages open without the identity proxy (no session handshake on a cold open, owner Oct 21); their member checks go through the APIs above.
 for(const url of ['/research','/research/news','/research/watchlist','/research/stocks','/research/market','/research/calendar','/research/learn','/research/general-news','/research/faq','/research/capital-map','/research/capital-map/sample']) assert.equal(matches(url),false,url);
 // Pages that read membership on the server stay behind the proxy.
 const server=url=>readFileSync(new URL('../app/research/'+url,import.meta.url),'utf8');
 for(const file of ['companies/[ticker]/page.tsx','account/page.tsx','account/sign-up/page.tsx']) assert.match(server(file),/getMembership/,file);
 for(const dir of ['news','watchlist','stocks','market','calendar','learn','general-news','faq','capital-map']) for(const file of ['page.tsx']) { try { assert.doesNotMatch(server(dir+'/'+file),/getMembership|@clerk\/nextjs\/server/,dir); } catch (error) { if (error.code==='ENOENT') continue; throw error; } }
 assert.doesNotMatch(server('page.tsx'),/getMembership|@clerk\/nextjs\/server/);
 assert.doesNotMatch(server('layout.tsx'),/initialMemberDisplay|auth\(/);
});

// Every account route must receive Clerk context before calling auth().
test('all account APIs receive Clerk identity, including nested owner routes',()=>{
 const source=readFileSync(new URL('../proxy.ts',import.meta.url),'utf8');
 const matcher=JSON.parse(source.match(/matcher:\s*(\[[^\]]+\])/)[1]);
 for(const path of ['','/profile','/contract','/deletion','/admin/members','/admin/delivery']) {
  const url='/api/research/account'+path;
  assert.equal(unstable_doesProxyMatch({config:{matcher},nextConfig:{},url}),true,url);
 }
});
