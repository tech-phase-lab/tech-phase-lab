import { ALTERNATIVE_LABELS } from "./comparison-labels.ts";
import type { TwelveComparisonSnapshot } from "./twelve-data-comparison.ts";
import { twelveNumber } from "./twelve-data-values.ts";
import { sameProviderSymbol } from "./provider-symbol.ts";
type Copy = { ja: string; en: string };
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const n = twelveNumber;
const day = 86400000;
const clamp = (v:number) => Math.round(Math.max(0,Math.min(10,v))*10)/10;
const validDate = (v:unknown):v is string => typeof v==="string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
/** How long a period's figures stay current: a quarter 180 days (as before); a half-year 270 days (its next report comes about eight months
 *  after the period ends); a fiscal year standing as a foreign filer's latest period 500 days (the next 20-F is due within four months of
 *  the following year end). */
export const periodMaxAgeDays = (months?: number) => months === 12 ? 500 : months === 6 ? 270 : 180;
export type TwelveFactorEvidence = {
  version: 1; periodEnd: string; retrievedAt: string;
  /** Set when the period is not a quarter (Financials.periodMonths). */
  periodMonths?: 6 | 12;
  statistics: null | { retrievedAt:string; quarterEnd:string; forwardPE:number|null; trailingPE:number|null;
    currentRatio:number|null; totalCash:number|null; totalDebt:number|null;
    /** Market value ÷ trailing four quarters' revenue. Used for every company in a comparison when any of them has no forward P/E (a loss-maker). */
    priceToSales?:number|null };
  margins: {periodEnd:string;value:number}[];
  /** "annual": the margins are four fiscal years (a foreign filer reporting yearly or half-yearly), said as such. */
  marginPeriod?: "annual";
  momentum: null | {from:string;to:string;changePct:number};
};
export const twelveFactorMethods: Record<string,Copy> = {
  financial:{ja:"財務健全性：流動比率2倍で5点、現金÷有利子負債1倍で5点。有利子負債は提出書類の記載の形（長期債務・短期借入・転換社債など）に合わせて合計します。借入・社債の記載が一つも無い会社は「借入なし」と表示して負債ゼロとして扱い、記載が読み取れない場合は点を付けません。",en:"Financial strength: up to 5 points at a 2× current ratio plus up to 5 at 1× cash/total debt. Debt is added up in the form the filing reports it (long-term debt, short-term borrowings, convertible notes). A company whose filing reports no borrowings or notes at all is shown as \"no borrowings\" and treated as debt-free; if the debt figures can't be read, no score is given."},
  valuation:{ja:"割安性：今のPERとPSRが、その会社の過去5年の平均（上下5%の極端な日を除く）よりどれだけ安いかを見ます。トレジャーハントと同じ計算です。平均と同じなら5点、50%安ければ10点、50%高ければ0点です。",en:"Valuation: how far today's P/E and P/S sit below the company's own five-year average (excluding the most extreme 5% of days at each end), the same calculation as Treasure Hunt. In line with the average scores 5, 50% below scores 10, and 50% above scores 0."},
  stability:{ja:"安定性：直近4四半期の営業黒字割合と営業利益率のばらつきから計算。株価の安定や将来の業績を保証する指標ではありません。",en:"Stability combines how many of four consecutive quarters were profitable with how much operating margins varied across those quarters. It doesn't measure stock-price stability or guarantee future results."},
  momentum:{ja:"株価モメンタム：分割調整済み日足の約3か月騰落率。0%＝5点、+50%＝10点、−50%＝0点。配当を含まず、上昇余地の予測ではありません。",en:"Momentum: the stock-price return over roughly three months, adjusted for stock splits. A 0% return scores 5, +50% scores 10, and −50% scores 0. Dividends aren't included, and this isn't a forecast."},
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
    if(root.status!=="error" && sameProviderSymbol(meta.symbol,snapshot.ticker) && typeof meta.currency==="string" && /^[A-Z]{3}$/.test(meta.currency)
      && f.most_recent_quarter===snapshot.periodEnd && Number.isFinite(Date.parse(statistics.retrievedAt)) && Date.parse(statistics.retrievedAt)<=now) {
      const nonnegative=(v:unknown)=>{const x=n(v);return x!==null && x>=0 ? x : null;};
      const positive=(v:unknown)=>{const x=n(v);return x!==null && x>0 ? x : null;};
      const eps=n(obj(f.income_statement).diluted_eps_ttm);
      stats={retrievedAt:statistics.retrievedAt,quarterEnd:snapshot.periodEnd,
        forwardPE:positive(v.forward_pe), trailingPE:eps!==null && eps>0 ? positive(v.trailing_pe) : null,
        currentRatio:nonnegative(b.current_ratio_mrq),totalCash:nonnegative(b.total_cash_mrq),totalDebt:nonnegative(b.total_debt_mrq),
        priceToSales:meta.currency===snapshot.currency ? positive(v.price_to_sales_ttm) : null};
    }
  }
  const root=obj(income), meta=obj(root.meta);
  let margins:TwelveFactorEvidence["margins"]=[];
  if(sameProviderSymbol(meta.symbol,snapshot.ticker) && meta.currency===snapshot.currency && meta.period==="Quarterly" && Array.isArray(root.income_statement)) {
    const byDate=new Map<string,(number|null)[]>();
    const profitField=snapshot.operatingIncomeBasis==="pretax" ? "pretax_income" : "operating_income";
    for(const raw of root.income_statement){const r=obj(raw),revenue=n(r.sales),profit=n(r[profitField]);
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
    if(series.adjust==="splits" && r.status!=="error" && sameProviderSymbol(m.symbol,snapshot.ticker) && m.interval==="1day" && typeof m.currency==="string" && /^[A-Z]{3}$/.test(m.currency)
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
/** Same factor values drive the radar, bars, winner highlights and saved copy. Valuation is not among them: it comes from Treasure Hunt's
 *  list (lib/research/comparison-value.ts, owner Nov 26), no longer from a fixed forward P/E or P/S scale. */
export function twelveExtraFactors(e:TwelveFactorEvidence,now=Date.now()) {
  const fresh=now-Date.parse(e.periodEnd)>=0 && now-Date.parse(e.periodEnd)<=periodMaxAgeDays(e.periodMonths)*day;
  const s=e.statistics;
  // The last good statistics count for up to a week (owner, Nov 26), as long as they describe the same quarter (quarterEnd, checked on reading).
  const stats=fresh && s && now-Date.parse(s.retrievedAt)>=0 && now-Date.parse(s.retrievedAt)<=7*day ? s : null;
  // Banks have no current ratio (HSBC, MUFG): cash against debt alone on the full ten-point scale, as for US banks from their filings.
  const financial=stats && stats.totalCash!==null && stats.totalDebt!==null
    ? stats.currentRatio!==null ? clamp(2.5*Math.min(stats.currentRatio,2)+5*(stats.totalDebt===0 ? 1 : Math.min(stats.totalCash/stats.totalDebt,1)))
      : clamp(10*(stats.totalDebt===0 ? 1 : Math.min(stats.totalCash/stats.totalDebt,1))) : null;
  let stability:number|null=null;
  if(fresh && e.margins.length===4) {
    const mean=e.margins.reduce((sum,m)=>sum+m.value,0)/4;
    const sd=Math.sqrt(e.margins.reduce((sum,m)=>sum+(m.value-mean)**2,0)/4);
    const profitable=e.margins.filter(m=>m.value>0).length/4;
    stability=clamp(profitable*(5+5*Math.max(0,1-sd/20)));
  }
  const m=e.momentum;
  const momentum=m && now-Date.parse(m.to)>=0 && now-Date.parse(m.to)<=7*day ? clamp(5+m.changePct/10) : null;
  return {financial,stability,momentum};
}
export function twelveFactorMetric(e:TwelveFactorEvidence,id:string,lang:"ja"|"en",now=Date.now()):string|null {
  const scores=twelveExtraFactors(e,now),ja=lang==="ja";
  if(id==="financial" && scores.financial!==null)return e.statistics!.currentRatio!==null ? `${ja?"流動比率":"Current ratio"} ${e.statistics!.currentRatio!.toFixed(2)}×`
    : e.statistics!.totalDebt===0 ? (ja?"借入なし":"No borrowings") : `${ja?"現金÷有利子負債":"Cash ÷ debt"} ${(e.statistics!.totalCash!/e.statistics!.totalDebt!).toFixed(2)}${ja?"倍":"×"}`;
  if(id==="stability" && scores.stability!==null)return e.marginPeriod==="annual" ? ALTERNATIVE_LABELS.annualStability(e.margins.filter(m=>m.value>0).length)[lang] : `${ja?"営業黒字":"Profitable"} ${e.margins.filter(m=>m.value>0).length}/4${ja?"四半期":" quarters"}`;
  if(id==="momentum" && scores.momentum!==null){const n=e.momentum!.changePct;return `${ja?"約3か月":"~3 months"} ${n>0?"+":""}${n.toFixed(1)}%`;}
  return null;
}
