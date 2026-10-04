"use client";
import Link from 'next/link';
import { useResearchLanguage } from '../use-research-language';
import ResearchToolShell from '../research-tool-shell';
import CompanySwitcher, {type CompanyOption} from './company-switcher';
import type { Copy } from '@/lib/research/data';
import type { MuWatchCard, muWatchFacts } from '@/lib/research/mu-watch';
import CompactQuote from './compact-quote';
import CompanyActivity from './company-activity';
import styles from './mu-watch.module.css';
type Props={companies:CompanyOption[];cards:MuWatchCard[]|null;titles:Copy[];facts:typeof muWatchFacts;source:string};
export default function MuWatch({companies,cards,titles,facts,source}:Props){
 const [lang,setLang]=useResearchLanguage();const ja=lang==='ja';
 const money=(n:number)=>ja?`${(n/100).toFixed(2)}億ドル`:`$${(n/1000).toFixed(3)}B`;
 return <ResearchToolShell lang={lang} setLang={setLang} title="Micron（MU）" description="" showTools={false} showHeading={false}>
  <CompanySwitcher ticker="MU" companies={companies} lang={lang} compact/>
  <header className={styles.heading}><h1>Micron（MU）</h1></header>
  <CompactQuote ticker="MU" exchange="NASDAQ" lang={lang}/>
  <CompanyActivity ticker="MU" lang={lang}/>
  <div className={styles.sectionTitle}><h2>{ja?'直近決算':'Latest earnings'}</h2><span>FQ4 2026</span></div>
  <p className={styles.dates}>{ja?'決算発表':'Released'} {facts.releasedOn}{ja?'（米国）／10月1日（日本）':' (US)'} <span>FQ4 2026 · {ja?'決算期末':'Period ended'} {facts.periodEnd}</span></p>
  <section className={styles.numbers} aria-label={ja?'今回の決算':'Quarterly results'}>
   <div><span>{ja?'売上高':'Revenue'}</span><strong>{money(facts.revenue.current)}</strong><small>{ja?'前四半期':'Prior quarter'} {money(facts.revenue.previous)}</small></div>
   <div><span>{ja?'調整後粗利益率':'Adjusted gross margin'}</span><strong>{facts.adjustedGrossMargin.current.toFixed(1)}%</strong><small>{ja?'前四半期':'Prior quarter'} {facts.adjustedGrossMargin.previous}%</small></div>
   <div><span>{ja?'次四半期の売上見通し':'Next-quarter revenue guidance'}</span><strong>{ja?'600–630億ドル':'$60–63B'}</strong><small>FQ1 2027 · {ja?'会社予想':'Company forecast'}</small></div>
  </section>
  <div className={styles.sectionTitle}><h2>{ja?'決算の読みどころ':'Earnings insights'}</h2><span>TECH PHASE PRO</span></div>
  <div className={styles.grid}>{titles.map((title,i)=><section className={styles.card} key={title.en}><div className={styles.cardTitle}><span>0{i+1}</span><h3>{title[lang]}</h3></div>{cards ? <><h4>{cards[i].headline[lang]}</h4><ul>{cards[i].points.map(p=><li key={p.en}>{p[lang]}</li>)}</ul><details><summary>{ja?'詳細・根拠':'Details & evidence'}</summary><p>{cards[i].detail[lang]}</p><a href={source} target="_blank" rel="noreferrer">{ja?'Micron公式決算資料':'Micron earnings release'} ↗</a><small>{cards[i].sourceSection}</small></details></> : <div className={styles.lock}><span aria-hidden="true">🔒</span><p>{ja?'PROで分析を読む':'Read analysis with PRO'}</p></div>}</section>)}</div>
  {!cards && <p className={styles.upgrade}><Link href="/research/account">{ja?'ログイン・プランを確認':'Sign in / View your plan'} →</Link></p>}
  <details className={styles.sources}><summary>{ja?'資料・更新について':'Sources & updates'}</summary><p>{ja?'資料確認：2026年10月4日。9月30日の公式決算発表をもとに作成した分析です。決算分析の自動更新は未接続です。「関連ニュース」は配信済み記事から更新します。':'Reviewed October 4, 2026, using the September 30 earnings release. Earnings analysis is not automatically updated. Related news refreshes from published articles.'}</p><a href={source} target="_blank" rel="noreferrer">{ja?'公式決算発表':'Official earnings release'} ↗</a><p>{ja?'B＝10億米ドル。調整後粗利益率はnon-GAAP。実績と会社見通しを区別しています。':'B = billion USD. Adjusted gross margin is non-GAAP. Actual results and company guidance are shown separately.'}</p></details>
 </ResearchToolShell>;
}
