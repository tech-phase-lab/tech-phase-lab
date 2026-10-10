import type { Copy } from './data';
import type { MuWatchCard } from './mu-watch';
import { verifiedChanges, type VerifiedChangeMetric } from './verified-changes.ts';
import extraEarnings from './watch-earnings.json' with { type: 'json' };
const c=(ja:string,en:string):Copy=>({ja,en});
export const watchTitles=[c('成長の中身','Growth drivers'),c('前回からの変化','What changed'),c('注意点','Risks to watch'),c('次に見るポイント','Next checkpoints')];
export type WatchTile={label:Copy;value:Copy;note:Copy};
export type WatchFacts={ticker:string;name:string;exchange:string;quoteTicker:string;period:string;releasedOn:string;periodEnd?:string;reviewedOn:string;sources:{url:string;title:string;location:string}[];tiles:WatchTile[]};
export type CompanyWatchData=WatchFacts & {cards:MuWatchCard[]};
export type WatchView=WatchFacts & {cards:MuWatchCard[]|null};
const names:Record<string,string>={NVDA:'NVIDIA',AMD:'AMD',AVGO:'Broadcom',CRWV:'CoreWeave',ARM:'Arm',TSM:'TSMC',ASML:'ASML',MRVL:'Marvell',ANET:'Arista Networks',CRDO:'Credo',SKHY:'SK hynix',SNDK:'Sandisk'};
// Headlines describe the source-backed result or a research checkpoint, never a rating.
const headings:Record<string,Copy[]>={
 NVDA:[c('売上の約93%をデータセンターが占める','Data Center accounts for about 93% of revenue'),c('売上・営業利益とも前四半期から拡大','Revenue and operating income grew sequentially'),c('中国売上を含まない次期見通し','Next-quarter outlook excludes China compute revenue'),c('増収見通しと粗利益率を照合','Compare revenue guidance with gross margin')],
 AMD:[c('データセンターが全社売上の58%','Data Center represents 58% of revenue'),c('営業利益が売上以上に伸びる','Operating income grew faster than revenue'),c('新製品の需要と売上化を分ける','Separate new-product demand from revenue'),c('次期売上と調整後粗利益率を確認','Track next-quarter sales and adjusted margin')],
 AVGO:[c('AI半導体の増収が加速','AI semiconductor revenue expanded'),c('営業利益が前四半期比約48%増','Operating income rose about 48% sequentially'),c('AI需要の顧客構成は確認が必要','AI demand needs customer-mix context'),c('AI半導体の次期見通しを追う','Track the AI semiconductor outlook')],
 CRWV:[c('売上は前年同期の2倍超','Revenue more than doubled year-on-year'),c('EBITDA増加と営業採算の悪化が併存','EBITDA growth coexists with weaker operating margins'),c('GAAP営業利益率はマイナスへ','GAAP operating margin turned negative'),c('契約残を売上・資金収支まで追う','Track backlog conversion and cash needs')],
 ARM:[c('ロイヤルティとライセンスが伸長','Royalty and licensing revenue both grew'),c('両収入とも前年同期比20%超増','Both streams grew over 20% year-on-year'),c('CPU需要は売上計上とは異なる','CPU demand is not recognized revenue'),c('需要と確保済み製造能力を照合','Compare demand with secured capacity')],
 TSM:[c('先端技術がウェハ売上の77%','Advanced nodes represent 77% of wafer revenue'),c('増収と利益率改善が並行','Revenue and margins improved together'),c('次期利益率見通しは今回を下回る','Next-quarter margin guidance is below current results'),c('2nm拡大と利益率をセットで追う','Track 2nm expansion alongside margins')],
 ASML:[c('保守・アップグレードも増収','Services and upgrades also grew'),c('粗利益率は1ポイント改善','Gross margin improved by one point'),c('受注から納入までの時期に注意','Watch timing between orders and delivery'),c('次期売上レンジと納入を照合','Check delivery against next-quarter guidance')],
 MRVL:[c('データセンターが全社以上に成長','Data Center grew faster than total revenue'),c('営業利益は前四半期比約35%増','Operating income rose about 35% sequentially'),c('AI受注は計上時期まで確認','Track when AI orders become revenue'),c('次期売上とGAAP粗利益率を確認','Track next-quarter revenue and GAAP margin')],
 ANET:[c('製品・サービスがともに成長','Products and services both grew'),c('営業利益率も前年同期から改善','Operating margin also improved year-on-year'),c('AI売上の内訳と顧客構成に注意','Watch AI revenue detail and customer mix'),c('次期利益率の基準を揃えて比較','Compare next-quarter margins on the same basis')],
 CRDO:[c('売上は増加、利益は減少','Revenue increased while profit fell'),c('営業費用は前四半期比約32%増','Operating expenses rose about 32% sequentially'),c('粗利益率低下と費用増が重なる','Lower gross margin meets higher expenses'),c('次期成長が採算改善につながるか','Will next-quarter growth improve profitability?')],
 SKHY:[c('HBM・サーバーDRAM・eSSDが寄与','HBM, server DRAM and eSSD contributed'),c('営業利益が売上以上に伸びる','Operating profit grew faster than revenue'),c('高い価格と利益率の持続性を確認','Watch the durability of pricing and margins'),c('HBM4とNANDの増産計画を追う','Track HBM4 and NAND production plans')],
 SNDK:[c('データセンター売上は前四半期の約2倍','Data Center revenue roughly doubled sequentially'),c('粗利益率は6.2ポイント改善','Gross margin rose 6.2 percentage points'),c('消費者向け売上は約32%減','Consumer revenue fell about 32%'),c('次期の増収と価格の持続性を確認','Track next-quarter growth and pricing durability')],
};
export function watchMetricValue(value:number,unit:VerifiedChangeMetric['unit']):Copy {
 const n=(v:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(v);
 if(unit==='percent')return c(`${n(value)}%`,`${n(value)}%`);
 if(unit==='krw-trillion')return c(`${n(value)}兆ウォン`,`₩${n(value)}T`);
 if(unit==='eur-billion')return c(`${n(value*10)}億ユーロ`,`€${n(value)}B`);
 return c(`${n(value*10)}億ドル`,`$${n(value)}B`);
}
const legacy:CompanyWatchData[]=verifiedChanges.map(v=>{
 const metricPoint=(m:VerifiedChangeMetric):Copy=>{
  const value=watchMetricValue(m.current,m.unit);const delta=`${m.change.value>=0?'+':''}${Number(m.change.value.toFixed(1))}`;
  return c(`${m.label.ja} ${value.ja}（${v.previousPeriod}比 ${delta}${m.change.unit==='pp'?'ポイント':'%'}）`,`${m.label.en} ${value.en} (${delta}${m.change.unit==='pp'?' pp':'%'} vs ${v.previousPeriod})`);
 };
 const riskPoints:Record<string,()=>Copy[]>={
  NVDA:()=>[v.outlook[2]],CRWV:()=>[metricPoint(v.metrics[1]),metricPoint(v.metrics[3])],TSM:()=>[v.outlook[1],v.outlook[2]],CRDO:()=>[metricPoint(v.metrics[1]),metricPoint(v.metrics[3])],SNDK:()=>[metricPoint(v.metrics[3])],
 };
 const selected=[v.metrics[0],v.metrics.find(m=>m.id.includes('margin'))??v.metrics[1],v.metrics.find(m=>m.id==='data-center'||m.id==='ai-semiconductor')??v.metrics.at(-1)!];
 // Keep each tile unique when there are only three metrics (e.g. TSM, ARM).
 const tiles=[...new Map(selected.map(m=>[m.id,m])).values()];
 for(const m of v.metrics)if(tiles.length<3&&!tiles.includes(m))tiles.push(m);
 const cards:MuWatchCard[]=[
 {title:watchTitles[0],headline:headings[v.ticker][0],points:[metricPoint(v.metrics[0])],detail:v.reading,sourceSection:v.source.location},
 {title:watchTitles[1],headline:headings[v.ticker][1],points:v.metrics.slice(1,3).map(metricPoint),detail:c(`比較対象：${v.previousPeriod} → ${v.currentPeriod}。利益率の差はパーセントポイント、金額の増減率は%で表示しています。`,`Comparison: ${v.previousPeriod} → ${v.currentPeriod}. Margin differences use percentage points; changes in monetary amounts use percent.`),sourceSection:v.source.location},
 {title:watchTitles[2],headline:headings[v.ticker][2],points:riskPoints[v.ticker]?.()??[v.unknown],detail:riskPoints[v.ticker]?v.unknown:c('不明点を悪化と断定せず、次回の開示で確認する項目です。','These are research uncertainties to check in subsequent disclosures, not evidence of deterioration.'),sourceSection:v.source.location},
 {title:watchTitles[3],headline:headings[v.ticker][3],points:v.outlook.slice(0,2),detail:c(v.outlook.slice(2).map(x=>x.ja).join('。')+'。見通し・計画と達成済みの実績を分けて追います。',v.outlook.slice(2).map(x=>x.en).join('. ')+'. Distinguish forecasts and plans from achieved results.'),sourceSection:v.source.location},
 ];
 return {ticker:v.ticker,name:names[v.ticker],exchange:v.ticker==='SKHY'?'KRX':['TSM','ANET'].includes(v.ticker)?'NYSE':'NASDAQ',quoteTicker:v.ticker==='SKHY'?'000660':v.ticker,period:v.currentPeriod,releasedOn:v.source.publishedOn,reviewedOn:v.reviewedOn,sources:[v.source,...(v.additionalSources??[])].map(s=>({url:s.url,title:s.title,location:s.location})),tiles:tiles.map(m=>({label:m.label,value:watchMetricValue(m.current,m.unit),note:m.previous===null?c(`${v.previousPeriod}比 ${m.change.value>0?'+':''}${Number(m.change.value.toFixed(1))}%`,`${m.change.value>0?'+':''}${Number(m.change.value.toFixed(1))}% vs ${v.previousPeriod}`):c(`${v.previousPeriod} ${watchMetricValue(m.previous,m.unit).ja}`,`${v.previousPeriod} ${watchMetricValue(m.previous,m.unit).en}`)})),cards};
});
export const companyWatches:CompanyWatchData[]=[...legacy,...extraEarnings.map(v=>({...v,cards:v.cards.map((card,i)=>({...card,title:watchTitles[i],sourceSection:v.sources[0].location}))}))];
// This boundary is called by the server route. Paid analysis is omitted, not CSS-hidden.
export function companyWatchForMember(ticker:string,member:{status:string;plan:string;accessExpiresAt?:number},now=Date.now()):WatchView|null {
 const item=companyWatches.find(x=>x.ticker===ticker);if(!item)return null;
 const {cards,...facts}=item;
 const allowed=member.status==='signed-in'&&member.plan==='pro'&&Number.isFinite(member.accessExpiresAt)&&member.accessExpiresAt!>now;
 return {...facts,cards:allowed?cards:null};
}
