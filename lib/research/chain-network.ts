import type {CompanyNetwork, NetworkMode} from './company-network.ts';
export function chainFocus(graph:CompanyNetwork,mode:NetworkMode){
 const root=graph.root,direct:string[]=[],rivals:string[]=[];
 for(const e of graph.edges){if(e.from!==root&&e.to!==root)continue;if(e.kind==='competition'&&e.from!==root)continue;const id=e.from===root?e.to:e.from;const list=e.kind==='competition'?rivals:direct;if(!list.includes(id))list.push(id);}
 const first=direct.slice(0,12);
 const competitors=new Set(rivals.filter(id=>!direct.includes(id)||first.includes(id)).slice(0,4));
 const ids=new Set([root,...first,...competitors]);
 // Only expand through displayed direct counterparties. Rival links do not imply a business chain.
 if(mode==='two')for(const e of graph.edges){if(e.kind==='competition')continue;if(first.includes(e.from)||first.includes(e.to))for(const id of [e.from,e.to])if(ids.size<21&&!direct.includes(id))ids.add(id);}
 if(mode==='all'){
  const connected=new Set([root]);let changed=true;
  while(changed){changed=false;for(const e of graph.edges){if(e.kind==='competition'||(!connected.has(e.from)&&!connected.has(e.to)))continue;for(const id of [e.from,e.to])if(!connected.has(id)){connected.add(id);changed=true;}}}
  connected.forEach(id=>ids.add(id));
 }
 const edges=graph.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)&&(e.kind==='competition'?e.from===root&&competitors.has(e.to):mode!=='direct'||e.from===root||e.to===root));
 const byId=new Map(graph.nodes.map(node=>[node.id,node]));
 return {nodes:[...ids].flatMap(id=>byId.has(id)?[byId.get(id)!]:[]),edges,competitors,direct:new Set(first)};
}
