"use client";
import Link from 'next/link';
import { useResearchLanguage } from '../use-research-language';
import ResearchToolShell from '../research-tool-shell';
import CompanySwitcher, {type CompanyOption} from './company-switcher';
import type { WatchView } from '@/lib/research/company-watch';
import type { CompanyDiveView } from '@/lib/research/company-dive';
import type { NewerReport } from '@/lib/research/dive-staleness';
import type { Copy } from '@/lib/research/data';
import QuoteCard from '../price/quote-card';
import CompanyActivity from './company-activity';
import EarningsDive from './earnings-dive';
import styles from './mu-watch.module.css';
import ProTag from '../pro-experience/pro-tag';

type Facts={ticker:string;name:string;quoteTicker:string};
/** A company page: the reviewed deep dive from lib/research/dives/<TICKER>.json when it exists, else the legacy cards (the fallback). */
export default function CompanyWatch({companies,watch,dive,titles,stale=null,ownerNotice=false}:{companies:CompanyOption[];watch:WatchView|null;dive?:CompanyDiveView|null;titles:Copy[];stale?:NewerReport|null;ownerNotice?:boolean}) {
 const [lang,setLang]=useResearchLanguage();
 const facts:Facts=(dive??watch)!;const name=`${facts.name}（${facts.ticker}）`;
 return <ResearchToolShell lang={lang} setLang={setLang} title={name} description="" showTools={false} showHeading={false}>
  <CompanySwitcher ticker={facts.ticker} companies={companies} lang={lang} compact/>
  <header className={styles.heading}><h1>{name}</h1></header>
  <QuoteCard ticker={facts.quoteTicker||facts.ticker} variant="gauge" from="watch" name={facts.name}/>
  <CompanyActivity key={facts.ticker} ticker={facts.ticker} lang={lang}/>
  {dive?<DiveEarnings view={dive} lang={lang} stale={stale} ownerNotice={ownerNotice}/>:watch&&<WatchEarnings watch={watch} titles={titles} lang={lang} stale={stale} ownerNotice={ownerNotice}/>}
 </ResearchToolShell>;
}
const day=(iso:string,lang:'ja'|'en')=>{const [y,m,d]=iso.split('-').map(Number);return lang==='ja'?`${y}年${m}月${d}日`:new Date(Date.UTC(y,m-1,d)).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});};
/** 直近決算, or, when the site already knows a newer release than the one shown, a dated heading that does not call it the latest. */
function LatestHeading({period,stale,ownerNotice,ticker,lang}:{period:string;stale:NewerReport|null;ownerNotice:boolean;ticker:string;lang:'ja'|'en'}){
 const ja=lang==='ja';
 return <>
  <div className={styles.sectionTitle}><h2>{stale?(ja?'前回の決算':'Previous earnings'):(ja?'直近決算':'Latest earnings')}</h2><span>{period}</span></div>
  {stale&&<p className={styles.dates} role="status">{ja?`${day(stale.on,lang)}に新しい決算${stale.period?`（${stale.period}）`:''}が発表されています。ここに表示しているのは${period}の内容で、最新の決算への更新を準備中です。`:`A newer report${stale.period?` (${stale.period})`:''} came out on ${day(stale.on,lang)}. This section still shows ${period}; the update to the latest results is in progress.`}</p>}
  {stale&&ownerNotice&&<p className={styles.dates}>{ja?`オーナー確認：lib/research/dives/${ticker}.json を ${stale.period??'最新の四半期'} に更新してください（${stale.source==='calendar'?'決算カレンダー':'SEC決算データ'}で確認）。`:`Owner check: update lib/research/dives/${ticker}.json to ${stale.period??'the latest quarter'} (seen in the ${stale.source==='calendar'?'earnings calendar':'SEC results data'}).`}</p>}
 </>;
}
function DiveEarnings({view,stale,ownerNotice,lang}:{view:CompanyDiveView;stale:NewerReport|null;ownerNotice:boolean;lang:'ja'|'en'}){
 const ja=lang==='ja';const paid=view.dive;
 return <>
  <LatestHeading period={view.period} stale={stale} ownerNotice={ownerNotice} ticker={view.ticker} lang={lang}/>
  <p className={styles.dates}>{ja?'決算発表':'Released'} {view.releasedOn} <span>{view.period} · {ja?'決算期末':'Period ended'} {view.periodEnd}</span></p>
  <section className={styles.numbers} aria-label={ja?'今回の決算':'Quarterly results'}>{view.tiles.map(t=><div key={t.label.en}><span>{t.label[lang]}</span><strong>{t.value[lang]}</strong><small>{t.note[lang]}</small></div>)}</section>
  <EarningsDive lang={lang} name={view.name} ticker={view.ticker} unlocked={!!paid} failed={false} history={paid?.history??[]}
   live={{period:view.period,releasedOn:view.releasedOn,dive:paid?{numbers:paid.numbers,summary:paid.summary,summaryAt:null,failed:false}:null}}
   currency={view.currency} periodQuarter={view.periodQuarter} reviewedOn={view.reviewedOn} marginBasis={view.grossMarginBasis} epsBasis={view.epsBasis}/>
  <details className={styles.sources}><summary>{ja?'資料・更新について':'Sources & updates'}</summary><p>{ja?'数値・解説の資料確認日':'Figures and analysis reviewed'}：{view.reviewedOn}。{ja?'数字はすべて会社の公式決算資料から引用し、出典の文言と照合しています。':'Every figure is taken from the company\'s official results materials and checked against the quoted source text.'}</p>{view.sources.map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></p>)}<p>{ja?`金額の単位は${view.currency==='USD'?'米ドル':view.currency==='EUR'?'ユーロ':view.currency==='TWD'?'台湾ドル':'韓国ウォン'}です。実績と会社見通しを区別しています。買い・売りの判定は行っていません。`:`Amounts are in ${view.currency}. Actual results and company guidance are shown separately. No buy or sell rating is assigned.`}</p></details>
 </>;
}
/** The latest results and the earnings deep dive (also shown by the PRO feature tour's fixed sample). */
export function WatchEarnings({watch,titles,lang,stale=null,ownerNotice=false}:{watch:WatchView;titles:Copy[];lang:'ja'|'en';stale?:NewerReport|null;ownerNotice?:boolean}) {
 const ja=lang==='ja';
 return <>
  <LatestHeading period={watch.period} stale={stale} ownerNotice={ownerNotice} ticker={watch.ticker} lang={lang}/>
  <p className={styles.dates}>{ja?'決算発表':'Released'} {watch.releasedOn} <span>{watch.period}{watch.periodEnd?` · ${ja?'決算期末':'Period ended'} ${watch.periodEnd}`:''}</span></p>
  <section className={styles.numbers} aria-label={ja?'今回の決算':'Quarterly results'}>{watch.tiles.map(t=><div key={t.label.en}><span>{t.label[lang]}</span><strong>{t.value[lang]}</strong><small>{t.note[lang]}</small></div>)}</section>
  <div className={styles.sectionTitle}><h2>{ja?'決算の深掘り':'Earnings Deep Dive'}</h2><ProTag/></div>
  <div className={styles.grid}>{titles.map((title,i)=>{const card=watch.cards?.[i];return <section className={styles.card} key={title.en}><div className={styles.cardTitle}><span>0{i+1}</span><h3>{title[lang]}</h3></div>{card?<><h4>{card.headline[lang]}</h4><ul>{card.points.map(p=><li key={p.en}>{p[lang]}</li>)}</ul><details><summary>{ja?'詳しい解説':'Details & sources'}</summary><p>{card.detail[lang]}</p>{watch.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{ja?'原典を確認（英語）':'Official source'} ↗ </a>)}<small>{ja?'参照：決算発表・数値表・会社見通し':card.sourceSection}</small></details></>:<div className={styles.lock}><span aria-hidden="true">🔒</span><p>{ja?'PROで分析を読む':'Read the full analysis with PRO'}</p></div>}</section>})}</div>
  {!watch.cards&&<p className={styles.upgrade}><Link href="/research/account">{ja?'ログイン・プランを確認':'Sign in / View your plan'} →</Link></p>}
  <details className={styles.sources}><summary>{ja?'資料・更新について':'Sources & updates'}</summary><p>{ja?'数値・解説の資料確認日':'Figures and analysis reviewed'}：{watch.reviewedOn}。{ja?'決算分析は掲載資料に基づく保存済みの解説です。新しい決算の自動反映は未接続です。リアルタイム監視は配信済みの記事を自動更新します。':'This analysis is based on the cited earnings release and doesn\'t automatically include newer results. The live news feed updates automatically.'}</p>{watch.sources.map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></p>)}<p>{ja?'B＝10億、M＝100万、T＝1兆。通貨・会計基準・実績と会社予想を各項目に表示。買い・売りの判定は行っていません。':'B = billion, M = million, T = trillion. Currency, accounting basis and forecasts are labeled per metric. No buy or sell rating is assigned.'}</p></details>
 </>;
}
