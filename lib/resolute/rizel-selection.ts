/** Private input only: never import the approved bank into a client bundle. */
export type CopyEntry = {id:string;group:'A'|'B'|'C'|'D';kind:'conclusion'|'reason';revision:number;approval:string;publication:string;text:string;textSha256:string;english?:{text:string;approval:string;textSha256:string}};
export type Evidence = {condition:string;articleRevision:string;source:string;verifiedBy:'data'|'editor';reference:string};
export type SelectionArticle = {id:string;revision:string;stars:number;text:string};
export type History = {id:string;usedAt:string}[];
export const conditions:Record<string,string> = {
 'D-price-target-01':'target_changed','D-price-target-02':'target_lowered','D-price-target-03':'target_changed','D-price-target-04':'target_changed',
 'D-executive-01':'executive_statement','D-executive-02':'executive_statement',
 'D-earnings-01':'earnings','D-earnings-02':'earnings','D-earnings-03':'earnings_slight_miss','D-earnings-04':'guidance_large_cut',
 'D-policy-01':'policy_proposal','D-policy-02':'policy_just_announced','D-policy-03':'policy',
 'D-rates-fx-01':'rates_rose','D-rates-fx-02':'rates_caused_price_fall','D-rates-fx-03':'fx_large_move','D-rates-fx-04':'rates_rose',
};
const numeric=new Set(['target_changed','target_lowered','earnings_slight_miss','guidance_large_cut','rates_rose','rates_caused_price_fall','fx_large_move']);
export function eligibleCopies(bank:CopyEntry[],article:SelectionArticle,evidence:Evidence[]) {
 if(!Number.isInteger(article.stars)||article.stars<1||article.stars>5||!article.id||!article.revision)throw Error('INVALID_ARTICLE');
 const group=article.stars<=2?'A':article.stars===3?'B':'C';
 const verified=new Set(evidence.filter(e=>e.articleRevision===article.revision&&e.source&&e.reference&&(e.verifiedBy==='data'||e.verifiedBy==='editor'&&!numeric.has(e.condition))).map(e=>e.condition));
 return bank.filter(e=>e.approval==='approved'&&e.english?.approval==='approved'&&e.id!=='D-executive-03'&&(e.group===group||e.group==='D'&&e.kind==='reason'&&conditions[e.id]&&verified.has(conditions[e.id])));
}
/** AI ranks relevant IDs, including alternatives. It cannot supply prose or facts. */
export type Ranker = (input:{article:SelectionArticle;candidates:{id:string;kind:string;text:string}[]})=>Promise<unknown>;
export async function selectRizel({bank,article,evidence,history,rank,now=new Date()}:{bank:CopyEntry[];article:SelectionArticle;evidence:Evidence[];history:History;rank:Ranker;now?:Date}) {
 const eligible=eligibleCopies(bank,article,evidence);
 if(new Set(eligible.map(e=>e.id)).size!==eligible.length)throw Error('DUPLICATE_COPY_ID');
 const output=await rank({article,candidates:eligible.map(({id,kind,text})=>({id,kind,text}))});
 if(!output||typeof output!=='object'||Object.keys(output).some(k=>!['conclusions','reasons'].includes(k)))throw Error('INVALID_AI_SELECTION');
 const o=output as {conclusions:unknown;reasons:unknown};
 const checked=(ids:unknown,kind:string)=>{
  if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!eligible.some(e=>e.id===id&&e.kind===kind)))throw Error('INVALID_AI_SELECTION');
  return ids.map(id=>eligible.find(e=>e.id===id)!);
 };
 const conclusions=checked(o.conclusions,'conclusion'), reasons=checked(o.reasons,'reason');
 const last=(id:string)=>Math.max(0,...history.filter(h=>h.id===id).map(h=>Date.parse(h.usedAt)).filter(Number.isFinite));
 const cutoff=(days:number)=>{const day=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);return Date.parse(day+'T00:00:00+09:00')-(days-1)*86400000;};
 const choose=(pool:CopyEntry[],days:number)=>pool.find(e=>last(e.id)<cutoff(days))??[...pool].sort((a,b)=>last(a.id)-last(b.id))[0];
 const conclusion=choose(conclusions,7);
 const selected:CopyEntry[]=[];
 for(let i=0;i<3;i++){
  const remaining=reasons.filter(e=>!selected.includes(e));
  // Respect the no-repeat window across ALL suitable reasons first.
  // Among fresh candidates prioritize D; only exhaustion permits LRU reuse.
  const fresh=remaining.filter(e=>last(e.id)<cutoff(10));
  const next=fresh.find(e=>e.group==='D')??fresh[0]??choose(remaining,10);
  if(next)selected.push(next);
 }
 // Never fabricate unsuitable reasons to fill three slots.
 const used=conclusion?[conclusion,...(selected.length===3?selected:[])]:[];
 return {articleId:article.id,articleRevision:article.revision,createdAt:now.toISOString(),publication:'withheld' as const,
  state:conclusion?'selected':'no-relevant-conclusion',ids:used.map(e=>e.id),
  copy:used.map(e=>({id:e.id,revision:e.revision,ja:e.text,en:e.english!.text,jaHash:e.textSha256,enHash:e.english!.textSha256})),
  audit:{article,evidence,eligibleIds:eligible.map(e=>e.id),ai:output,history,reasonCount:selected.length===3?3:0}};
}
