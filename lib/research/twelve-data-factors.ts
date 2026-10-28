import type { TwelveComparisonSnapshot } from "./twelve-data-comparison.ts";
import { twelveNumber } from "./twelve-data-values.ts";
type Copy = { ja: string; en: string };
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const n = twelveNumber;
const day = 86400000;
const clamp = (v:number) => Math.round(Math.max(0,Math.min(10,v))*10)/10;
const validDate = (v:unknown):v is string => typeof v==="string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
export type TwelveFactorEvidence = {
  version: 1; periodEnd: string; retrievedAt: string;
  statistics: null | { retrievedAt:string; quarterEnd:string; forwardPE:number|null; trailingPE:number|null;
    currentRatio:number|null; totalCash:number|null; totalDebt:number|null };
  margins: {periodEnd:string;value:number}[];
  momentum: null | {from:string;to:string;changePct:number};
};
export const twelveFactorMethods: Record<string,Copy> = {
  financial:{ja:"財務健全性：流動比率2倍で5点、現金÷有利子負債1倍で5点。負債ゼロは明示された場合だけ扱います。",en:"Financial strength: up to 5 points at a 2× current ratio plus up to 5 at 1× cash/total debt. Missing debt is not zero."},
  valuation:{ja:"割安性：予想PER 10倍＝9点、20倍＝7点、30倍＝5点、40倍＝3点、55倍以上＝0点の共通目盛り。同業順位や適正株価ではなく、循環的な利益のピークは調整していません。",en:"Valuation: a common forward P/E scale: 10× = 9, 20× = 7, 30× = 5, 40× = 3, 55× or more = 0. Not a peer ranking or fair value; peak-cycle earnings are not normalized."},
  stability:{ja:"安定性：直近4四半期の営業黒字割合と営業利益率のばらつきから計算。株価の安定や将来の業績を保証する指標ではありません。",en:"Stability combines the share of profitable quarters and dispersion of operating margins over four consecutive quarters. It does not measure share-price stability or guarantee future results."},
  momentum:{ja:"株価モメンタム：分割調整済み日足の約3か月騰落率。0%＝5点、+50%＝10点、−50%＝0点。配当を含まず、上昇余地の予測ではありません。",en:"Momentum: roughly three-month split-adjusted price return. 0% = 5, +50% = 10, −50% = 0. Excludes dividends and is not a forecast."},
};
/** Extra endpoints are optional. Failure of one factor never discards usable quarterly results.
 * Timestamps belong to each actual request, not the time a cached record is displayed.
 */
export function normalizeTwelveFactors(snapshot:TwelveComparisonSnapshot, income:unknown,
  statistics?:{payload:unknown;retrievedAt:string},
  series?:{payload:unknown;adjust:"splits";retrievedAt:string}, now=Date.now()):TwelveFactorEvidence {
  let stats:TwelveFactorEvidence["statistics"]=null;
  if(statistics) {
    const root=obj(statistics.payload), meta=obj(root.meta), s=obj(root.statistics), f=obj(s.financials), b=obj(f.balance_sheet), v=obj(s.valuations_metrics);
    if(root.status!=="error" && meta.symbol===snapshot.ticker && typeof meta.currency==="string" && /^[A-Z]{3}$/.test(meta.currency)
      && f.most_recent_quarter===snapshot.periodEnd && Number.isFinite(Date.parse(statistics.retrievedAt)) && Date.parse(statistics.retrievedAt)<=now) {
      const nonnegative=(v:unknown)=>{const x=n(v);return x!==null && x>=0 ? x : null;};
      const positive=(v:unknown)=>{const x=n(v);return x!==null && x>0 ? x : null;};
      const eps=n(obj(f.income_statement).diluted_eps_ttm);
      stats={retrievedAt:statistics.retrievedAt,quarterEnd:snapshot.periodEnd,
        forwardPE:positive(v.forward_pe), trailingPE:eps!==null && eps>0 ? positive(v.trailing_pe) : null,
        currentRatio:nonnegative(b.current_ratio_mrq),totalCash:nonnegative(b.total_cash_mrq),totalDebt:nonnegative(b.total_debt_mrq)};
    }
  }
  const root=obj(income), meta=obj(root.meta);
  let margins:TwelveFactorEvidence["margins"]=[];
  if(meta.symbol===snapshot.ticker && meta.currency===snapshot.currency && meta.period==="Quarterly" && Array.isArray(root.income_statement)) {
    const byDate=new Map<string,(number|null)[]>();
    for(const raw of root.income_statement){const r=obj(raw),revenue=n(r.sales),profit=n(r.operating_income);
      if(!validDate(r.fiscal_date) || r.fiscal_date>snapshot.periodEnd)continue;
      const margin=revenue!==null && revenue>0 && profit!==null ? profit/revenue*100 : null;
      const list=byDate.get(r.fiscal_date)??[];list.push(margin!==null && Number.isFinite(margin)?margin:null);byDate.set(r.fiscal_date,list);
    }
    const latest=[...byDate.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,4);
    if(latest.length===4 && latest[0][0]===snapshot.periodEnd && latest.every(([end,values],i)=>
      values[0]!==null && values.every(v=>v===values[0]) && (i===0 || (Date.parse(latest[i-1][0])-Date.parse(end))/day>=70 && (Date.parse(latest[i-1][0])-Date.parse(end))/day<=110)))
      margins=latest.map(([periodEnd,values])=>({periodEnd,value:values[0]!}));
  }
  let momentum:TwelveFactorEvidence["momentum"]=null;
  if(series) {
    const r=obj(series.payload),m=obj(r.meta),seen=new Set<string>();
    if(series.adjust==="splits" && r.status!=="error" && m.symbol===snapshot.ticker && m.interval==="1day" && typeof m.currency==="string" && /^[A-Z]{3}$/.test(m.currency)
      && Number.isFinite(Date.parse(series.retrievedAt)) && Date.parse(series.retrievedAt)<=now && Array.isArray(r.values)) {
      let conflict=false;
      const points=r.values.flatMap(raw=>{const row=obj(raw),close=n(row.close);
        // Exclude today's possibly incomplete daily bar; no intraday close masquerading as EOD.
        if(!validDate(row.datetime) || row.datetime>=new Date(Date.parse(series.retrievedAt)).toISOString().slice(0,10))return [];
        if(seen.has(row.datetime))conflict=true;seen.add(row.datetime);
        return close!==null && close>0 ? [{date:row.datetime,close}] : [];
      }).sort((a,b)=>b.date.localeCompare(a.date));
      const last=points[0],prior=last && points.find(p=>Date.parse(last.date)-Date.parse(p.date)>=90*day);
      if(!conflict && last && prior && Date.parse(last.date)-Date.parse(prior.date)<=97*day
        && now-Date.parse(last.date)<=7*day && now-Date.parse(series.retrievedAt)<=7*day) {
        const changePct=(last.close/prior.close-1)*100;
        if(Number.isFinite(changePct))momentum={from:prior.date,to:last.date,changePct};
      }
    }
  }
  return {version:1,periodEnd:snapshot.periodEnd,retrievedAt:snapshot.retrievedAt,statistics:stats,margins,momentum};
}
/** Same factor values drive the radar, bars, winner highlights and saved copy. */
export function twelveExtraFactors(e:TwelveFactorEvidence,now=Date.now()) {
  const fresh=now-Date.parse(e.periodEnd)>=0 && now-Date.parse(e.periodEnd)<=180*day;
  const s=e.statistics;
  const stats=fresh && s && now-Date.parse(s.retrievedAt)>=0 && now-Date.parse(s.retrievedAt)<=36*3600000 ? s : null;
  const financial=stats && stats.currentRatio!==null && stats.totalCash!==null && stats.totalDebt!==null
    ? clamp(2.5*Math.min(stats.currentRatio,2)+5*(stats.totalDebt===0 ? 1 : Math.min(stats.totalCash/stats.totalDebt,1))) : null;
  const valuation=stats?.forwardPE ? clamp(11-stats.forwardPE/5) : null;
  let stability:number|null=null;
  if(fresh && e.margins.length===4) {
    const mean=e.margins.reduce((sum,m)=>sum+m.value,0)/4;
    const sd=Math.sqrt(e.margins.reduce((sum,m)=>sum+(m.value-mean)**2,0)/4);
    const profitable=e.margins.filter(m=>m.value>0).length/4;
    stability=clamp(profitable*(5+5*Math.max(0,1-sd/20)));
  }
  const m=e.momentum;
  const momentum=m && now-Date.parse(m.to)>=0 && now-Date.parse(m.to)<=7*day ? clamp(5+m.changePct/10) : null;
  return {financial,valuation,stability,momentum};
}
export function twelveFactorMetric(e:TwelveFactorEvidence,id:string,lang:"ja"|"en",now=Date.now()):string|null {
  const scores=twelveExtraFactors(e,now),ja=lang==="ja";
  if(id==="financial" && scores.financial!==null)return `${ja?"流動比率":"Current ratio"} ${e.statistics!.currentRatio!.toFixed(2)}×`;
  if(id==="valuation" && scores.valuation!==null)return `${ja?"予想PER":"Forward P/E"} ${e.statistics!.forwardPE!.toFixed(1)}×`;
  if(id==="stability" && scores.stability!==null)return `${ja?"営業黒字":"Profitable"} ${e.margins.filter(m=>m.value>0).length}/4${ja?"四半期":" quarters"}`;
  if(id==="momentum" && scores.momentum!==null){const n=e.momentum!.changePct;return `${ja?"約3か月":"~3 months"} ${n>0?"+":""}${n.toFixed(1)}%`;}
  return null;
}
