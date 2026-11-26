/** あなたへの影響 (owner, Nov 26 spec §4): how much a Shock Gauge story concerns THIS member, by fixed rules and data only (no AI).
 * The ★ says how big the story is for the market; this says how close it is to the member. Computed on the member's device,
 * because the PRO holdings live only in that browser.
 * Levels: 3 特大 a held stock itself; 2 大 a watchlist stock, or a supplier / competitor of a held stock; 1 中 the sector the member
 * named in the diagnosis (q21), a supplier / competitor of a watchlist stock, or market-wide news; 0 小 anything else.
 * The needle sits in the level's quarter of the gauge, further right with more related stocks and a larger held weight. */
export type ImpactHints={tickers:string[];related:string[];sector:string|null;marketWide:boolean};
export type ImpactMember={held:{ticker:string;weight:number}[];watch:string[];sector:string|null};
export type ImpactLogo={ticker:string;kind:'held'|'watch'};
export type Impact={level:0|1|2|3;position:number;logos:ImpactLogo[]}|{level:null;position:null;logos:[]};
export const IMPACT_LABELS={ja:['小','中','大','特大'],en:['Low','Medium','High','Very high']} as const;
const TICKER=/^[A-Z][A-Z0-9.]{0,9}$/;
export function parseImpactHints(v:unknown):ImpactHints|null{
 if(v===null||v===undefined)return null;const x=v as ImpactHints;
 const list=(a:unknown)=>Array.isArray(a)?[...new Set(a.filter((t):t is string=>typeof t==='string'&&TICKER.test(t)))].slice(0,60):null;
 const tickers=list(x?.tickers),related=list(x?.related);
 if(!x||typeof x!=='object'||!tickers||!related||!(x.sector===null||typeof x.sector==='string'&&/^[a-z_]{1,30}$/.test(x.sector))||typeof x.marketWide!=='boolean')throw Error('INVALID_IMPACT');
 return {tickers,related,sector:x.sector,marketWide:x.marketWide};
}
export function storyImpact(h:ImpactHints|null|undefined,member:ImpactMember):Impact{
 if(!member.held.length&&!member.watch.length)return {level:null,position:null,logos:[]};
 const hints=h??{tickers:[],related:[],sector:null,marketWide:false};
 const story=new Set(hints.tickers),near=new Set(hints.related);
 const heldDirect=member.held.filter(x=>story.has(x.ticker)),heldNear=member.held.filter(x=>!story.has(x.ticker)&&near.has(x.ticker));
 const watchDirect=member.watch.filter(t=>story.has(t)&&!heldDirect.some(x=>x.ticker===t)),watchNear=member.watch.filter(t=>!story.has(t)&&near.has(t)&&!member.held.some(x=>x.ticker===t));
 let level:0|1|2|3,count:number,weight=0;
 if(heldDirect.length){level=3;count=heldDirect.length;weight=heldDirect.reduce((a,x)=>a+x.weight,0);}
 else if(watchDirect.length||heldNear.length){level=2;count=watchDirect.length+heldNear.length;weight=heldNear.reduce((a,x)=>a+x.weight,0);}
 else if(watchNear.length||member.sector&&hints.sector===member.sector||hints.marketWide){level=1;count=watchNear.length;}
 else{level=0;count=0;}
 const logos:ImpactLogo[]=[...heldDirect.map(x=>({ticker:x.ticker,kind:'held' as const})),...watchDirect.map(t=>({ticker:t,kind:'watch' as const})),
  ...heldNear.map(x=>({ticker:x.ticker,kind:'held' as const})),...(level===1?watchNear.map(t=>({ticker:t,kind:'watch' as const})):[])].slice(0,3);
 // Each level owns a quarter of the gauge; inside it the needle moves right with more related stocks and a larger held weight.
 const within=Math.min(20,4+4*Math.max(0,count-1)+16*Math.min(1,weight));
 return {level,position:level*25+within,logos};
}
/** The member's held stocks with their weight in the portfolio (by cost), from the PRO asset tool's holdings on this device. */
export function heldWeights(holdings:readonly {ticker:string;shares:number;avgCostUsd:number}[]):{ticker:string;weight:number}[]{
 const by=new Map<string,number>();for(const h of holdings)by.set(h.ticker,(by.get(h.ticker)??0)+h.shares*h.avgCostUsd);
 const total=[...by.values()].reduce((a,b)=>a+b,0);
 return [...by].map(([ticker,v])=>({ticker,weight:total>0?v/total:0}));
}
