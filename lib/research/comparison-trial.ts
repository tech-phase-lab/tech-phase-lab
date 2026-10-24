import { createHash } from 'node:crypto';
import input from '../../fixtures/research/mu-sndk-20261004.json' with { type: 'json' };
import { emptyFinancials, type ComparisonResult, type Fact } from './comparison.ts';
import { evaluateReference } from './comparison-reference.ts';
const cp=(ja:string,en:string)=>({ja,en});
/** Explicit dated trial only. Never used as a fallback for the live data loader. */
export function buildReviewedTrial(tickers:string[]):ComparisonResult | null {
 if(tickers.length!==2||new Set(tickers).size!==2||!tickers.every(t=>input.companies.some(c=>c.ticker===t)))return null;
 const companies=tickers.map(ticker=>{
  const started=performance.now();
  const d=input.companies.find(c=>c.ticker===ticker)!;
  const factor=evaluateReference(d,input.benchmark);
  const fact=(value:number,tag:string,start:string|null=d.start):Fact=>({value:value*1e6,unit:'USD',start,end:d.end,filed:d.announced,accession:'reviewed-trial',tag,basis:'us-gaap'});
  const revenueGrowth=(d.rev/d.prior-1)*100, margin=d.op/d.rev*100, pe=d.close/d.annualEps;
  const nextGrowth=((d.guide[0]+d.guide[1])/2/d.rev-1)*100;
  const items=[
   {id:'growth',kind:'strength' as const,short:cp(`売上前年比＋${revenueGrowth.toFixed(1)}%`,`Revenue YoY +${revenueGrowth.toFixed(1)}%`),detail:cp(`最新四半期の売上${d.rev.toLocaleString()}百万ドル、前年同期${d.prior.toLocaleString()}百万ドル。対象期末${d.end}。`,`Latest quarterly revenue: $${d.rev.toLocaleString()}m vs $${d.prior.toLocaleString()}m a year earlier. Period ended ${d.end}.`)},
   {id:'margin',kind:'strength' as const,short:cp(`営業利益率${margin.toFixed(1)}%`,`Operating margin ${margin.toFixed(1)}%`),detail:cp(`GAAP営業利益${d.op.toLocaleString()}百万ドル÷売上。`,`GAAP operating income $${d.op.toLocaleString()}m / revenue.`)},
   {id:'cash',kind:'strength' as const,short:cp(`調整FCF ${(d.adjustedFcf/100).toFixed(1)}億ドル`,`Adjusted FCF $${(d.adjustedFcf/1000).toFixed(2)}bn`),detail:cp(`会社定義の調整FCF。MUとSNDKでは調整内容が異なるため、この金額を直接順位付けしません。営業CF−現金設備投資は別に計算。`,`Company-defined adjusted FCF. Adjustment definitions differ, so amounts are not directly ranked. Operating CF less cash capex is calculated separately.`)},
   {id:'relative',kind:'weakness' as const,short:d.ticker==='MU'?cp('次期増収予想はSNDKを下回る','Next-quarter growth outlook trails SNDK'):cp('実績PERはMUより高い','Trailing P/E exceeds MU'),detail:d.ticker==='MU'?cp(`次期会社売上予想${d.guide[0]}〜${d.guide[1]}百万ドル。中央値による前期比+${nextGrowth.toFixed(1)}%。SNDKは+17.7%。予想の対象四半期は異なります。`,`Company revenue guidance $${d.guide[0]}–${d.guide[1]}m, midpoint growth +${nextGrowth.toFixed(1)}% QoQ versus SNDK +17.7%. Forecast quarters differ.`):cp(`10/2終値÷最新通期GAAP EPS=${pe.toFixed(2)}倍。MUは14.46倍。成長期待を考慮した絶対的割高判定ではありません。`,`October 2 close / latest annual GAAP EPS = ${pe.toFixed(2)}× versus MU 14.46×. This does not establish absolute overvaluation.`)},
   {id:'risk',kind:'weakness' as const,short:d.ticker==='MU'?cp('メモリ価格下落時の減益リスク','Memory price declines could hurt earnings'):cp('前受金が営業CFを押し上げ','Prepayments boost operating cash flow'),detail:d.ticker==='MU'?cp('分析上のリスク。メモリ販売価格が下がれば利益が圧迫される可能性があります。価格下落の発生を示す記述ではありません。','Analytical risk: lower memory selling prices could pressure profits. This does not assert that prices have fallen.'):cp('NBM前受金等1,938百万ドルを会社の調整FCFで控除。簡易FCF率だけでは持続的な資金創出力を過大評価し得ます。','Company-adjusted FCF excludes $1,938m of NBM prepayments and deposits. Simple FCF alone may overstate recurring cash generation.')},
  ];
  const f={...emptyFinancials(ticker,'unavailable',input.asOf),status:'ready' as const,name:d.name,peer:'memory',caution:cp('決算期間・事業構成とCF調整の差があります。','Reporting periods, business mix and CF adjustments differ.'),quarterRevenue:fact(d.rev,'Revenue'),previousQuarterRevenue:{...fact(d.prior,'Revenue'),start:null,end:d.ticker==='MU'?'2025-08-28':'2025-06-27'},quarterOperatingIncome:fact(d.op,'OperatingIncome'),quarterRevenueGrowth:revenueGrowth,quarterOperatingMargin:margin,quarterFcfMargin:(d.operatingCash-d.capex)/d.rev*100,quarterSourceUrl:d.source,referenceEvaluation:{asOf:input.asOf,announced:d.announced,factors:factor,sources:input.sources,observations:[
 cp(`10/2終値 $${d.close}、最新通期GAAP EPS $${d.annualEps}。`,`October 2 close $${d.close}; latest annual GAAP EPS $${d.annualEps}.`),
 cp(`期末${d.end}：現金${d.cash}、開示有利子負債${d.debt}、流動資産${d.currentAssets}、流動負債${d.currentLiabilities}（百万USD）。`,`As of ${d.end}: cash ${d.cash}, disclosed debt ${d.debt}, current assets ${d.currentAssets}, current liabilities ${d.currentLiabilities} ($m).`),
 cp(`四半期営業CF ${d.operatingCash} − 現金設備投資${d.capex} = 簡易FCF ${d.operatingCash-d.capex}（百万USD）。`,`Quarterly operating CF ${d.operatingCash} − cash capex ${d.capex} = simple FCF ${d.operatingCash-d.capex} ($m).`),
 cp(`直近4四半期の売上：${d.revenues.join(' / ')}、営業利益：${d.operatingIncomes.join(' / ')}（百万USD）。`,`Last four quarterly revenue: ${d.revenues.join(' / ')}; operating income: ${d.operatingIncomes.join(' / ')} ($m).`),
 cp(`対象期末：${d.periods.join(' / ')}。MUの第4四半期は14週。`,`Quarter ends: ${d.periods.join(' / ')}. MU Q4 contains 14 weeks.`),
 cp(`7/2→10/2終値：$${d.historyStart}→$${d.close}。同期間NASDAQ100：29,329.21→30,807.93。`,`July 2 → October 2 closes: $${d.historyStart} → $${d.close}; Nasdaq-100: 29,329.21 → 30,807.93.`),
 ]},preparedAnalysis:{version:1 as const,method:'reviewed' as const,sourceRevision:createHash('sha256').update(JSON.stringify(d)).digest('hex'),preparedAt:new Date().toISOString(),processingMs:Math.round((performance.now()-started)*1000)/1000,periodEnd:d.end,sourceUrl:d.source,items}};
  return f;
 });
 return {companies,comparable:true,reasons:[],conclusion:cp('MUは実績PER・収益性で優位','MU leads on trailing P/E and profitability'),generatedAt:new Date().toISOString(),trial:{id:input.id,description:cp('SNDKは次期増収見通しと簡易FCF率で上回ります。前受金の影響には注意。','SNDK leads in next-quarter growth guidance and simple FCF margin; prepayments affect cash flow.'),notes:cp('2026/10/4時点の実データ検証。株価は10/2通常取引終値。最新予想PER・PEGは未検証。同業順位・総合投資判断ではありません。MUの期末9/3と発表9/30（日本10/1）は別の日付です。','Dated October 4, 2026 trial using October 2 regular-session closes. Forward P/E and PEG are unverified. Scores are not peer ranks or an overall investment judgment. MU period end September 3 differs from September 30 release (October 1 JST).')}};
}
