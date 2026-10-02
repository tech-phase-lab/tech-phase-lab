import type { ResearchEvent } from './data';

export type ResultBrief = {
  id:string; researchId:string; kind:'earnings'|'economic'; ticker:string; period:string;
  titleJa:string; titleEn:string; facts:{key:string;ja:string;en:string;value:string}[];
  url:string; publisher:string; publishedAt:string; observedAt:string; publicAt:string;
  processingMs:number; sourceToDetectionMs:number|null; detectionToPublicMs:number|null;
};

export function parseResultBriefs(value: unknown): ResultBrief[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length>20) throw Error('Invalid results');
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw Error('Invalid result');
    const r=raw as Record<string,unknown>;
    const field=(name:string,max=180) => {const v=r[name]; if(typeof v!=='string'||!v.trim()||v.length>max||v.includes('\0')) throw Error('Invalid result field'); return v;};
    const id=field('id',24), kind=field('kind',12), ticker=field('ticker',10), researchId=field('researchId',40);
    const url=new URL(field('url',250));
    if(!/^\d+$/.test(id)||researchId!==`x-result-${id}`||!['earnings','economic'].includes(kind)||!/^([A-Z][A-Z0-9.-]{0,9})$/.test(ticker)
      ||url.origin!=='https://x.com'||url.search||url.hash||!/^\/(tipranks|theflynews|wallstengine|fabymetal4)\/status\/\d+$/i.test(url.pathname)) throw Error('Invalid result source');
    const date=(name:string)=>{const v=field(name,50);if(!/T.*(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Invalid result date');return v;};
    if(!Array.isArray(r.facts)||!r.facts.length||r.facts.length>8)throw Error('Invalid result facts');
    const facts=r.facts.map(f=>{
      if(!f||typeof f!=='object')throw Error('Invalid fact');
      const o=f as Record<string,unknown>;
      for(const k of ['key','ja','en','value'])if(typeof o[k]!=='string'||!(o[k] as string).trim()||(o[k] as string).length>80)throw Error('Invalid fact');
      if(!/^(?:guidance-)?(?:revenue|eps|gross-margin|operating-cash-flow|actual|nonfarm-payrolls|unemployment-rate|hourly-earnings-mom|hourly-earnings-yoy)$/.test(o.key as string)
        ||!/^\$?[-+]?\d+(?:\.\d+)?[BMK%]?(?: ± \$?\d+(?:\.\d+)?[BMK%]?)?$/i.test(o.value as string))throw Error('Invalid fact value');
      return {key:o.key as string,ja:o.ja as string,en:o.en as string,value:o.value as string};
    });
    const duration=(name:string,nullable=false)=>{const v=r[name];if(nullable&&v===null)return null;if(typeof v!=='number'||!Number.isInteger(v)||v<0||v>7*86400000)throw Error('Invalid duration');return v;};
    return {id,researchId,kind:kind as ResultBrief['kind'],ticker,period:field('period',40),titleJa:field('titleJa'),titleEn:field('titleEn'),facts,url:url.href,publisher:field('publisher',80),publishedAt:date('publishedAt'),observedAt:date('observedAt'),publicAt:date('publicAt'),processingMs:duration('processingMs')!,sourceToDetectionMs:duration('sourceToDetectionMs',true),detectionToPublicMs:duration('detectionToPublicMs',true)};
  });
}

export function resultEvents(briefs:ResultBrief[]): ResearchEvent[] {
  const seen=new Set<string>();
  return briefs.filter(r=>r.kind==='earnings').sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||b.researchId.localeCompare(a.researchId)).filter(r=>{const k=r.ticker+r.period;if(seen.has(k))return false;seen.add(k);return true;}).map(r=>{
    const copy=(ja:string,en:string)=>({ja,en});
    const facts=r.facts.map(f=>({text:copy(`${f.ja}：${f.value}`,`${f.en}: ${f.value}`),sourceIds:[r.researchId]}));
    return {id:r.researchId,ticker:r.ticker,company:r.ticker,category: ['MU','SKHY','SNDK','NVDA','AMD','ARM','TSM','ASML','AMAT','INTC','AEHR'].includes(r.ticker)?'memory':['NBIS','IREN','MSFT','AMZN','GOOGL','META','PLTR','APP'].includes(r.ticker)?'cloud':'other',kind:'earnings',
      publishedOn:r.publishedAt.slice(0,10),reviewedOn:r.publicAt.slice(0,10),
      title:copy(r.titleJa,r.titleEn),summary:copy(r.titleJa,r.titleEn),change:copy(r.titleJa,r.titleEn),facts,
      interpretation:r.facts.some(f=>f.key.startsWith('guidance-')) ? copy('実績と会社見通しを分けて掲載しています。','Reported results and company guidance are shown separately.') : copy('投稿に記載された決算実績を整理しています。','This note summarises the reported results in the source post.'),
      unknown:copy('速報に記載された数値を整理しています。市場予想は比較していません。','These are reported flash figures. Consensus is not compared.'),
      next:copy('会社の決算資料で実績と見通しを確認します。','Confirm the results and guidance against the company release.'),
      sources:[{id:r.researchId,url:r.url,title:r.period+' earnings',publisher:r.publisher,publishedOn:r.publishedAt.slice(0,10),location:'Reported numbers in the source post'}],metrics:[]};
  });
}
