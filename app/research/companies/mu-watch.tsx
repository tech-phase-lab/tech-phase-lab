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
import {useWatchEarnings} from './use-watch-earnings';
type Props={companies:CompanyOption[];cards:MuWatchCard[]|null;titles:Copy[];facts:typeof muWatchFacts;source:string};
export default function MuWatch({companies,cards,titles,facts,source}:Props){
 const [lang,setLang]=useResearchLanguage();const ja=lang==='ja';
 const {live,failed,status,observedAt}=useWatchEarnings();
 const shownCards=live?live.cards:cards;const shownSource=live?.sourceUrl??source;
 const money=(n:number)=>ja?`${(n/100).toFixed(2)}億ドル`:`$${(n/1000).toFixed(3)}B`;
 return <ResearchToolShell lang={lang} setLang={setLang} title="Micron（MU）" description="" showTools={false} showHeading={false}>
  <CompanySwitcher ticker="MU" companies={companies} lang={lang} compact/>
  <header className={styles.heading}><h1>Micron（MU）</h1></header>
  <CompactQuote ticker="MU" exchange="NASDAQ" lang={lang}/>
  <CompanyActivity ticker="MU" lang={lang}/>
  <div className={styles.sectionTitle}><h2>{ja?'直近決算':'Latest earnings'}</h2><span>{live?.period??'FQ4 2026'}</span></div>
  {live ? <p className={styles.dates}>{ja?'決算発表':'Released'} {live.releasedOn} <span>{live.period}</span></p> : <p className={styles.dates}>{ja?'決算発表':'Released'} {facts.releasedOn}{ja?'（米国）／10月1日（日本）':' (US)'} <span>FQ4 2026 · {ja?'決算期末':'Period ended'} {facts.periodEnd}</span></p>}
  <section className={styles.numbers} aria-label={ja?'今回の決算':'Quarterly results'}>
   {live ? live.tiles.map(tile=><div key={tile.label.en}><span>{tile.label[lang]}</span><strong>{tile.value[lang]}</strong><small>{tile.note[lang]}</small></div>) : <><div><span>{ja?'売上高':'Revenue'}</span><strong>{money(facts.revenue.current)}</strong><small>{ja?'前四半期':'Prior quarter'} {money(facts.revenue.previous)}</small></div>
   <div><span>{ja?'調整後粗利益率':'Adjusted gross margin'}</span><strong>{facts.adjustedGrossMargin.current.toFixed(1)}%</strong><small>{ja?'前四半期':'Prior quarter'} {facts.adjustedGrossMargin.previous}%</small></div>
   <div><span>{ja?'次四半期の売上見通し':'Next-quarter revenue guidance'}</span><strong>{ja?'600–630億ドル':'$60–63B'}</strong><small>FQ1 2027 · {ja?'会社予想':'Company forecast'}</small></div></>}
  </section>
  {(failed||status==='partial') && <p className={styles.dates}>{ja?'更新を完了できていない項目があります。表示中の決算発表日をご確認ください。':'Some updates are incomplete. Check the release date shown.'}</p>}
  <div className={styles.sectionTitle}><h2>{ja?'決算の読みどころ':'Earnings insights'}</h2><span>TECH PHASE PRO</span></div>
  <div className={styles.grid}>{titles.map((title,i)=><section className={styles.card} key={title.en}><div className={styles.cardTitle}><span>0{i+1}</span><h3>{title[lang]}</h3></div>{shownCards ? <><h4>{shownCards[i].headline[lang]}</h4><ul>{shownCards[i].points.map(p=><li key={p.en}>{p[lang]}</li>)}</ul><details><summary>{ja?'詳しい解説':'Details & evidence'}</summary><p>{shownCards[i].detail[lang]}</p><a href={shownSource} target="_blank" rel="noreferrer">{ja?'原典を確認（英語）':'Micron earnings release'} ↗</a><small>{ja?(live?"該当箇所：四半期実績・業績見通し":["該当箇所：部門別決算・製品動向","該当箇所：四半期決算","該当箇所：部門別決算・業績見通し","該当箇所：業績見通し・製品動向"][i]):shownCards[i].sourceSection}</small></details></> : <div className={styles.lock}><span aria-hidden="true">🔒</span><p>{ja?'PROで分析を読む':'Read analysis with PRO'}</p></div>}</section>)}</div>
  {!shownCards && <p className={styles.upgrade}><Link href="/research/account">{ja?'ログイン・プランを確認':'Sign in / View your plan'} →</Link></p>}
  <details className={styles.sources}><summary>{ja?'資料・更新について':'Sources & updates'}</summary>{live ? <><p>{ja?'取得済みのMU公式決算から数値と日英要点を自動更新します。対応形式外の項目は補完しません。':'Numbers and bilingual points update from retained MU issuer releases. Unsupported fields are not inferred.'}</p><p>{ja?'方式：数値の定型生成（LLM不使用）':'Method: deterministic numeric templates (no LLM)'} · {live.processingMs} ms</p><p>{ja?'公式発表時刻':'Source publication time'}：{live.publishedAt??(ja?'時刻未確認（日付のみ）':'Time unavailable (date only)')}<br/>{ja?'初取得':'First detected'}：{live.detectedAt}<br/>{ja?'原文取得':'Body ready'}：{live.bodyReadyAt}<br/>{ja?'日英準備開始':'Preparation started'}：{live.preparedAt}<br/>{ja?'バックエンド公開':'Backend publication'}：{live.publicAt}<br/>{ja?'この画面で更新を確認':'Update observed in this view'}：{observedAt??'—'}</p><p>{ja?'発表→取得':'Source → detection'}：{live.sourceToDetectionMs===null?'—':`${live.sourceToDetectionMs} ms`} · {ja?'取得→公開':'Detection → publication'}：{live.detectionToPublicMs===null?'—':`${live.detectionToPublicMs} ms`}</p><p>{ja?'公開済みの過去決算を今回処理した場合、その時間は速報配信の実績ではありません。画面の観測時刻はこの閲覧セッション内の確認時刻です。':'Processing an older release now is not evidence of live delivery speed. The view observation time applies only to this browsing session.'}</p></> : <p>{ja?'資料確認：2026年10月4日。保存済みの決算解説を表示しています。自動更新データを取得できた場合に切り替わります。':'Reviewed October 4, 2026. Showing saved earnings analysis until an automatic snapshot is available.'}</p>}<a href={shownSource} target="_blank" rel="noreferrer">{ja?'公式決算発表（英語）':'Official earnings release'} ↗</a><p>{ja?'B＝10億米ドル。調整後粗利益率はnon-GAAP。実績と会社見通しを区別しています。':'B = billion USD. Adjusted gross margin is non-GAAP. Actual results and company guidance are shown separately.'}</p></details>
 </ResearchToolShell>;
}
