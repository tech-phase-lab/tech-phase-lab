import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import nextTesting from 'next/experimental/testing/server.js';
// Installed Next version retains the previous name for the proxy matcher helper.
const {unstable_doesMiddlewareMatch: unstable_doesProxyMatch} = nextTesting;

test('Clerk proxy covers every interactive membership API including PRO columns',()=>{
 const source=readFileSync(new URL('../proxy.ts',import.meta.url),'utf8');
 const matcher=JSON.parse(source.match(/matcher:\s*(\[[^\]]+\])/)[1]);
 const matches=url=>unstable_doesProxyMatch({config:{matcher},nextConfig:{},url});
 for(const url of ['/research/account','/research/account/sign-up','/api/research/member','/api/research/member/preview','/api/research/articles/example','/api/research/notifications','/api/research/posts','/api/research/author','/api/research/questions','/api/research/questions/moderation']) assert.equal(matches(url),true,url);
 for(const url of ['/research','/api/research/editor','/api/research/news','/api/research/notifications/entitlement']) assert.equal(matches(url),false,url);
});
