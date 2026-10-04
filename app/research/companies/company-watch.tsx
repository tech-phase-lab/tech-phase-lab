"use client";
import Link from 'next/link';
import { useResearchLanguage } from '../use-research-language';
import ResearchToolShell from '../research-tool-shell';
import CompanySwitcher, {type CompanyOption} from './company-switcher';
import type { WatchView } from '@/lib/research/company-watch';
import type { Copy } from '@/lib/research/data';
import CompactQuote from './compact-quote';
import CompanyActivity from './company-activity';
import styles from './mu-watch.module.css';
export default function CompanyWatch({companies,watch,titles}:{companies:CompanyOption[];watch:WatchView;titles:Copy[]}) {
 const [lang,setLang]=useResearchLanguage();const ja=lang==='ja';const name=`${watch.name}（${watch.ticker}）`;
 return <ResearchToolShell lang={lang} setLang={setLang} title={name} description="" showTools={false} showHeading={false}>
  <CompanySwitcher ticker={watch.ticker} companies={companies} lang={lang} compact/>
  <header className={styles.heading}><h1>{name}</h1></header>
  <CompactQuote ticker={watch.ticker} quoteTicker={watch.quoteTicker} exchange={watch.exchange} lang={lang}/>
  <CompanyActivity key={watch.ticker} ticker={watch.ticker} lang={lang}/>
  <div className={styles.sectionTitle}><h2>{ja?'直近決算':'Latest earnings'}</h2><span>{watch.period}</span></div>
  <p className={styles.dates}>{ja?'決算発表':'Released'} {watch.releasedOn} <span>{watch.period}{watch.periodEnd?` · ${ja?'決算期末':'Period ended'} ${watch.periodEnd}`:''}</span></p>
  <section className={styles.numbers} aria-label={ja?'今回の決算':'Quarterly results'}>{watch.tiles.map(t=><div key={t.label.en}><span>{t.label[lang]}</span><strong>{t.value[lang]}</strong><small>{t.note[lang]}</small></div>)}</section>
  <div className={styles.sectionTitle}><h2>{ja?'決算の読みどころ':'Earnings insights'}</h2><span>TECH PHASE PRO</span></div>
  <div className={styles.grid}>{titles.map((title,i)=>{const card=watch.cards?.[i];return <section className={styles.card} key={title.en}><div className={styles.cardTitle}><span>0{i+1}</span><h3>{title[lang]}</h3></div>{card?<><h4>{card.headline[lang]}</h4><ul>{card.points.map(p=><li key={p.en}>{p[lang]}</li>)}</ul><details><summary>{ja?'詳しい解説':'Details & evidence'}</summary><p>{card.detail[lang]}</p>{watch.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{ja?'原典を確認（英語）':'Official source'} ↗ </a>)}<small>{ja?'参照：決算発表・数値表・会社見通し':card.sourceSection}</small></details></>:<div className={styles.lock}><span aria-hidden="true">🔒</span><p>{ja?'PROで分析を読む':'Read analysis with PRO'}</p></div>}</section>})}</div>
  {!watch.cards&&<p className={styles.upgrade}><Link href="/research/account">{ja?'ログイン・プランを確認':'Sign in / View your plan'} →</Link></p>}
  <details className={styles.sources}><summary>{ja?'資料・更新について':'Sources & updates'}</summary><p>{ja?'数値・解説の資料確認日':'Figures and analysis reviewed'}：{watch.reviewedOn}。{ja?'決算分析は掲載資料に基づく保存済みの解説です。新しい決算の自動反映は未接続です。リアルタイム監視は配信済みの記事を自動更新します。':'Earnings analysis is saved commentary based on the cited release; new earnings are not automatically incorporated. Live monitor refreshes published articles automatically.'}</p>{watch.sources.map(s=><p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></p>)}<p>{ja?'B＝10億、M＝100万、T＝1兆。通貨・会計基準・実績と会社予想を各項目に表示。買い・売りの判定は行っていません。':'B = billion, M = million, T = trillion. Currency, accounting basis and forecasts are labeled per metric. No buy or sell rating is assigned.'}</p></details>
 </ResearchToolShell>;
}
