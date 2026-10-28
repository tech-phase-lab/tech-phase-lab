import test from 'node:test';
import assert from 'node:assert/strict';
import {companyNetworkFor} from '../lib/research/chain-network.server.ts';
import universe from '../lib/research/chain_universe.json' with {type:'json'};
test('registered index issuers can render a map without a company introduction',()=>{
 const issuers=universe.companies.filter(c=>c.group==='index_root');
 assert.ok(issuers.length>0,'Index roster registration must precede publication');
 for(const issuer of issuers){
  const graph=companyNetworkFor({ticker:issuer.id,cik:issuer.cik});
  assert.equal(graph?.root,issuer.id);
  assert.equal(graph.nodes.find(n=>n.id===issuer.id)?.name,issuer.name);
 }
});
test('a different SEC issuer cannot borrow an index company map',()=>{
 const issuer=universe.companies.find(c=>c.group==='index_root');
 assert.ok(issuer);
 assert.equal(companyNetworkFor({ticker:issuer.id,cik:1}),null);
 assert.equal(companyNetworkFor({ticker:'UNREGISTERED',cik:issuer.cik}),null);
});
