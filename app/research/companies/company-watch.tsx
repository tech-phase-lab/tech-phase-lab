"use client";
import Link from 'next/link';
import { useResearchLanguage } from '../use-research-language';
import ResearchToolShell from '../research-tool-shell';
import CompanySwitcher, {type CompanyOption} from './company-switcher';
import type { WatchView } from '@/lib/research/company-watch';
import type { CompanyDiveView } from '@/lib/research/company-dive';
import type { NewerReport } from '@/lib/research/dive-staleness';
import type { LiveRelease } from '@/lib/research/company-earnings-live';
import type { Copy } from '@/lib/research/data';
import QuoteCard from '../price/quote-card';
import CompanyActivity from './company-activity';
import EarningsDive from './earnings-dive';
import styles from './mu-watch.module.css';
import ProTag from '../pro-experience/pro-tag';

type Facts={ticker:string;name:string;quoteTicker:string};
/** A company page: the reviewed deep dive from lib/research/dives/<TICKER>.json when it exists, else the legacy cards (the fallback). */
export default function CompanyWatch({companies,watch,dive,live=null,titles,stale=null,ownerNotice=false}:{companies:CompanyOption[];watch:WatchView|null;dive?:CompanyDiveView|null;live?:LiveRelease|null;titles:Copy[];stale?:NewerReport|null;ownerNotice?:boolean}) {
 const [lang,setLang]=useResearchLanguage();
 const facts:Facts=(dive??watch)!;const name=`${facts.name}（${facts.ticker}）`;
 return <ResearchToolShell lang={lang} setLang={setLang} title={name} description="" showTools={false} showHeading={false}>
  <CompanySwitcher ticker={facts.ticker} companies={companies} lang={lang} compact/>
  <header className={styles.heading}><h1>{name}</h1></header>
  <QuoteCard ticker={facts.quoteTicker||facts.ticker} variant="gauge" from="watch" name={facts.name}/>
  <CompanyActivity key={facts.ticker} ticker={facts.ticker} lang={lang}/>
  {dive?<DiveEarnings view={dive} live={live} lang={lang} stale={stale} ownerNotice={ownerNotice}/>:watch&&<WatchEarnings watch={watch} titles={titles} lang={lang} stale={stale} ownerNotice={ownerNotice}/>}
 </ResearchToolShell>;
}
/** 直近決算, or, when the site already knows a newer release than the one shown, a dated heading that does not call it the latest. */
function LatestHeading({period,stale,ownerNotice,ticker,lang}:{period:string;stale:NewerReport|null;ownerNotice:boolean;ticker:string;lang:'ja'|'en'}){
 const ja=lang==='ja';
 return <>
  <div className={styles.sectionTitle}><h2>{stale?(ja?'前回の決算':'Previous earnings'):(ja?'直近決算':'Latest earnings')}</h2><span>{period}</span></div>
  {stale&&<p className={styles.dates} role="status">{ja?'新しい決算を準備中です':'New results coming soon'}</p>}
  {stale&&ownerNotice&&<p className={styles.dates}>{ja?`オーナー確認：lib/research/dives/${ticker}.json を ${stale.period??'最新の四半期'} に更新してください。${stale.source==='calendar'?'決算カレンダー':'SEC決算データ'}で確認しました。`:`Owner check: update lib/research/dives/${ticker}.json to ${stale.period??'the latest quarter'} (seen in the ${stale.source==='calendar'?'earnings calendar':'SEC results data'}).`}</p>}
 </>;
}
/** `live`: a newer quarter read from the company's release (lib/research/company-earnings-live.ts) for the top of the section; the
 * deep dive below keeps the file's quarter, which its own header names. */
function DiveEarnings({view,live,stale,ownerNotice,lang}:{view:CompanyDiveView;live:LiveRelease|null;stale:NewerReport|null;ownerNotice:boolean;lang:'ja'|'en'}){
 const ja=lang==='ja';const paid=view.dive;
 const top=live?{period:live.period,releasedOn:live.releasedOn,periodEnd:null,tiles:live.tiles}:view;
 const sources=live?[{url:live.sourceUrl,title:live.publisher},...view.sources.filter(s=>s.url!==live.sourceUrl)]:view.sources;
 return <>
  <LatestHeading period={top.period} stale={stale} ownerNotice={ownerNotice} ticker={view.ticker} lang={lang}/>
  <p className={styles.dates}>{ja?'決算発表':'Released'} {top.releasedOn} <span>{top.period}{top.periodEnd?` · ${ja?'決算期末':'Period ended'} ${top.periodEnd}`:''}</span></p>
  <section className={styles.numbers} aria-label={ja?'今回の決算':'Quarterly results'}>{top.tiles.map(t=><div key={t.label.en}><span>{t.label[lang]}</span><strong>{t.value[lang]}</strong><small>{t.note[lang]}</small></div>)}</section>
  <EarningsDive lang={lang} name={view.name} ticker={view.ticker} unlocked={!!paid} failed={false} history={paid?.history??[]}
   live={{period:view.period,releasedOn:view.releasedOn,dive:paid?{numbers:paid.numbers,summary:paid.summary,summaryAt:null,failed:false}:null}}
   currency={view.currency} periodQuarter={view.periodQuarter} reviewedOn={view.reviewedOn} marginLabel={view.labels.margin} epsLabel={view.labels.eps}/>
  {paid&&view.labels.guidanceNote&&<p className={styles.dates}>{ja?'次期の見通しの算出方法（会社資料の記載・英語）':'How the outlook figures were derived'}：{view.labels.guidanceNote}</p>}
  <details className={styles.sources}><summary>{ja?'資料・更新について':'Sources & updates'}</summary><p>{ja?`出典：会社の決算資料（${view.reviewedOn}）`:`Source: company results materials (${view.reviewedOn})`}。{ja?'数字はすべて会社の公式決算資料から引用し、出典の文言と照合しています。':'Every figure is taken from the company\'s official results materials and checked against the quoted source text.'}</p>{sources.map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></p>)}<p>{ja?`単位：${view.currency==='USD'?'ドル':view.currency==='EUR'?'ユーロ':view.currency==='TWD'?'台湾ドル':'韓国ウォン'}`:`Unit: ${view.currency}`}</p></details>
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
  <details className={styles.sources}><summary>{ja?'資料・更新について':'Sources & updates'}</summary><p>{ja?`出典：会社の決算資料（${watch.reviewedOn}）`:`Source: company results materials (${watch.reviewedOn})`}</p>{watch.sources.map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></p>)}<p>{ja?'B＝10億・M＝100万・T＝1兆':'B = billion · M = million · T = trillion'}</p></details>
 </>;
}
