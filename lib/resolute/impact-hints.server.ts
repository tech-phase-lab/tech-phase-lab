import 'server-only';
import {chainDataFor,chainTickers} from '@/lib/research/chain-map-data';
import {namedCompanies,industryOf} from './risk-companies.ts';
import type {ImpactHints} from './impact.ts';

/** The public facts behind あなたへの影響 (owner, Nov 26 spec §4), added to each story of the member's feed on the server: the
 * story's own tickers, the companies tied to them in the relationship data (suppliers, customers and competitors, both ways), its
 * sector, and whether it is market-wide news. Nothing about the member is sent here; the level is decided on the device. */
let index:Map<string,Set<string>>|null=null;
function neighbours():Map<string,Set<string>>{
 if(index)return index;
 const out=new Map<string,Set<string>>(),link=(a:string,b:string)=>{if(a===b)return;if(!out.has(a))out.set(a,new Set());out.get(a)!.add(b);};
 for(const root of chainTickers()){const d=chainDataFor(root);if(!d)continue;
  for(const t of [...d.companies.map(c=>c.ticker),...d.rivals])if(typeof t==='string'&&t){link(root,t);link(t,root);}}
 return index=out;
}
type Story={market?:{index?:string;company?:{ticker?:string;basket?:string}};ja?:{title?:string};en?:{title?:string}};
export function impactHints(a:Story):ImpactHints{
 const tickers=[...new Set([a.market?.company?.ticker,...namedCompanies(`${a.en?.title??''} ${a.ja?.title??''}`)].filter((t):t is string=>typeof t==='string'))].slice(0,5);
 const related=[...new Set(tickers.flatMap(t=>[...(neighbours().get(t)??[])]))].filter(t=>!tickers.includes(t)).slice(0,60);
 const index_=a.market?.index,semis=index_==='sox'||a.market?.company?.basket==='sox'||tickers.some(t=>industryOf(t)==='sox');
 return {tickers,related,sector:semis?'tech_semis':null,marketWide:index_==='nas100'};
}
/** The member feed with the hints added to each story (anything unexpected is left as it was). */
export function withImpactHints(body:unknown):unknown{
 if(!body||typeof body!=='object'||!Array.isArray((body as {articles?:unknown}).articles))return body;
 const b=body as {articles:Story[]};
 try{return {...b,articles:b.articles.map(a=>a&&typeof a==='object'?{...a,impact:impactHints(a)}:a)};}catch{return body;}
}
