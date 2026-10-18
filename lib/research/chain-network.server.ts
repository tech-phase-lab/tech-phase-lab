import universe from './chain_universe.json' with {type:'json'};
import relations from './chain_relations.json' with {type:'json'};
import states from './chain_status.json' with {type:'json'};
import {companyIntroductionFor} from './company-introductions.ts';
import type {CompanyNetwork,NetworkEdge,NetworkNode} from './company-network.ts';
const companyById=new Map(universe.companies.map(c=>[c.id,c]));
export function companyNetworkFor(issuer:{cik:number;ticker:string}):CompanyNetwork|null{
 const profile=companyIntroductionFor(issuer);if(!profile)return null;
 const root=profile.tickers[0],ids=new Set([root]);
 let changed=true;while(changed){changed=false;for(const row of relations){if(row.type==='競合')continue;if(ids.has(row.from)||ids.has(row.to))for(const id of [row.from,row.to])if(!ids.has(id)){ids.add(id);changed=true;}}}
 for(const row of relations)if(row.type==='競合'&&row.from===root){ids.add(row.to);}
 const rows=relations.filter(r=>ids.has(r.from)&&ids.has(r.to)&&(r.type!=='競合'||r.from===root));
 const nodes:NetworkNode[]=[...ids].map(id=>{const c=companyById.get(id);const row=rows.find(r=>r.from===id||r.to===id);return {id,ticker:/^[A-Z.]{1,6}$/.test(id)?id:undefined,name:c?.name??profile.name,kind:'company',layer:id===root?3:5,businessLabel:row?{ja:row.text_ja,en:row.text_ja}:undefined}});
 const edges:NetworkEdge[]=rows.map((r,i)=>({id:`chain:${i}:${r.from}:${r.to}:${r.type}`,from:r.type==='供給・採用元'?r.to:r.from,to:r.type==='供給・採用元'?r.from:r.to,kind:r.type==='競合'?'competition':r.type==='提携・出資・技術対応'?'partner':'supply',evidence:[{about:r.from,label:{ja:r.text_ja,en:r.text_ja},reviewedOn:r.source_date,evidence_quote:r.evidence_quote,sources:[{label:`公式資料 · ${r.source_date}`,url:r.source_url}]}]}));
 return {root,nodes,edges,status:(states as Record<string,string>)[root]??'pending'};
}
