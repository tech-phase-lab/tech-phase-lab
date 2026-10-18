import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {companyNetworkFor} from '../lib/research/chain-network.server.ts';

test('live company profile uses the complete reviewed NVIDIA map',()=>{
 const graph=companyNetworkFor({ticker:'NVDA',cik:1045810});
 assert.equal(graph.nodes.length,41);
 assert.equal(graph.edges.length,61);
 assert.equal(createHash('sha256').update(JSON.stringify(graph)).digest('hex'),'29f71db1aeb70e90a6b18f3837389c9c1ad5873a7255f3914862339b99a302a4');
 assert.equal(companyNetworkFor({ticker:'NVDA',cik:1}),null);
});

import {nvidiaNetworkView} from '../lib/research/nvidia-network.ts';
import {networkFocus} from '../lib/research/company-network.ts';
test('NVDA display is limited to eight cards directly and twenty at two steps including the root',()=>{
 const source=companyNetworkFor({ticker:'NVDA',cik:1045810});
 for(const [mode,limit] of [['direct',8],['two',20],['all',20]]){
  const view=nvidiaNetworkView(source,mode);
  assert.ok(view.nodes.length<=limit);
  assert.ok(view.nodes.some(n=>n.id==='NVDA'));
  assert.equal(new Set(view.nodes.map(n=>n.id)).size,view.nodes.length);
  const ids=new Set(view.nodes.map(n=>n.id));
  assert.ok(view.edges.every(e=>ids.has(e.from)&&ids.has(e.to)));
  const allowed=networkFocus(source,'NVDA',mode);
  assert.ok(view.nodes.every(n=>allowed.distances.has(n.id)||allowed.competitors.has(n.id)));
 }
 assert.equal(nvidiaNetworkView(source,'direct').nodes.length,8);
 assert.equal(nvidiaNetworkView(source,'two').nodes.length,20);
 assert.equal(source.nodes.length,41);
 assert.equal(source.edges.length,61);
});
