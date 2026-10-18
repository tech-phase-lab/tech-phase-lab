import test from 'node:test';
import assert from 'node:assert/strict';
import {chainFocus} from '../lib/research/chain-network.ts';
import {expansionGraph} from './fixtures/chain-map.mjs';

test('BE expands through NBIS and Oracle, and all includes the third hop',()=>{
 const direct=chainFocus(expansionGraph,'direct'),two=chainFocus(expansionGraph,'two'),all=chainFocus(expansionGraph,'all');
 assert.deepEqual(direct.nodes.map(n=>n.id),['BE','NBIS','ORCL']);
 assert.deepEqual(two.nodes.map(n=>n.id),['BE','NBIS','ORCL','PLTR','NVDA','AMZN']);
 assert.deepEqual(all.nodes.map(n=>n.id),['BE','NBIS','ORCL','PLTR','NVDA','AMZN','MSFT']);
 assert.deepEqual([direct.edges.length,two.edges.length,all.edges.length],[2,5,6]);
});
test('incoming rival evidence does not become BE competition and disconnected companies stay absent',()=>{
 const graph={...expansionGraph,nodes:[...expansionGraph.nodes,{id:'OTHER'}],edges:[...expansionGraph.edges,{id:'reverse-rival',from:'OTHER',to:'BE',kind:'competition'}]};
 for(const mode of ['direct','two','all']){const focus=chainFocus(graph,mode);assert.equal(focus.competitors.size,0);assert.ok(!focus.nodes.some(n=>n.id==='OTHER'));assert.ok(!focus.edges.some(e=>e.id==='reverse-rival'));}
});
test('two-hop cap excludes third hops even with abundant second-hop evidence',()=>{
 const graph={root:'BE',nodes:[{id:'BE'},{id:'NBIS'},...Array.from({length:35},(_,i)=>({id:`SECOND${i}`})),{id:'THIRD'}],edges:[{id:'direct',from:'BE',to:'NBIS',kind:'partner'},...Array.from({length:35},(_,i)=>({id:`second-${i}`,from:'NBIS',to:`SECOND${i}`,kind:'partner'})),{id:'third',from:'SECOND0',to:'THIRD',kind:'partner'}]};
 const focus=chainFocus(graph,'two');assert.equal(focus.nodes.length,21);assert.ok(!focus.nodes.some(n=>n.id==='THIRD'));assert.equal(chainFocus(graph,'all').nodes.length,38);
});
