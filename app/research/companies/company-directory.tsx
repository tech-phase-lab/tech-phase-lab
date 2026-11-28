'use client';
import PageHeading from "../page-heading";
import Link from 'next/link';
import type { Language } from '@/lib/research/data';
import base from '../research.module.css';
import styles from './company-directory.module.css';
import { useFreshCompanies } from './use-fresh-companies';
import { useMemberDisplay, useOwnerAccount } from '../member-display-provider';
import { companyHref } from '@/lib/research/company-href';
import { useLiveQuotes } from '../price/use-live-quote';
import { useNumbersHidden, type CardQuote } from '../price/use-market';
import FlashValue from '../price/flash-value';
import { plain, signedPercent } from '@/lib/research/market-quote';
export type DirectoryCompany = {ticker:string;name:string;sector:{ja:string;en:string};verified:boolean};
/** `onOpen` (the PRO feature tour's fixed sample): the tiles stay on the page and report the tap; no feed is read and no page is linked. */
/** A tile's price and day change (owner, Nov 27: the 監視22銘柄 numbers move in real time). The text colour flashes mint up / red down. */
function TilePrice({ticker,quote}:{ticker:string;quote:CardQuote|undefined}) {
 if(!quote)return <span className={styles.quote} aria-hidden="true">—</span>;
 const pct=quote.percentChange,tone=pct===null||pct===0?styles.flat:pct>0?styles.up:styles.down;
 return <span className={styles.quote}><FlashValue scope={ticker} value={quote.price} className={styles.price} quick>{plain(quote.price)}</FlashValue><FlashValue scope={ticker} value={quote.change} className={`${styles.change} ${tone}`} quick>{pct===null?'—':signedPercent(pct)}</FlashValue></span>;
}
export default function CompanyDirectory({companies,lang,onOpen}:{companies:DirectoryCompany[];lang:Language;onOpen?:(ticker:string)=>void}) {
 const ja=lang==='ja';
 // All 22 in one batched request to our quotes route (shared copies), every 15 seconds while U.S. stocks trade. The tour's sample reads nothing.
 const live=useLiveQuotes(companies.map(company=>company.ticker),!onOpen);
 const [hidden]=useNumbersHidden();
 const showPrices=!onOpen&&!hidden;
 const fresh=useFreshCompanies(lang,!onOpen);
 // The company pages are PRO only (owner, Nov 25): without PRO a tile opens the stock's FREE page.
 const ownerAccount=useOwnerAccount(),plan=useMemberDisplay();
 const pro=ownerAccount||plan==='pro';
 const freshCompanies=companies.filter(company=>fresh.has(company.ticker)).length;
 const groups=new Map<string,DirectoryCompany[]>();
 for(const company of companies){const key=company.sector[lang];groups.set(key,[...(groups.get(key)??[]),company]);}
 return <section id="monitored-companies" aria-labelledby="monitored-companies-title">
  {ja&&<PageHeading eyebrow="COMPANY WATCH" title={`監視${companies.length}銘柄リスト`} description={`厳選した${companies.length}銘柄の動きを、ひと目で。`} titleId="monitored-companies-title"/>}
  <div className={base.directoryHead}>
   {!ja&&<div><p className={base.eyebrow}>COMPANY WATCH</p><h1 id="monitored-companies-title">{`${companies.length}-stock watch list`}</h1></div>}
   <div className={base.directoryLegend}>{freshCompanies>0&&<span className={styles.freshChip} role="status"><i className={styles.freshDot} aria-hidden="true"/>{ja?`新着あり ${freshCompanies}銘柄`:`${freshCompanies} with new items`}</span>}<span><i className={base.verifiedDot} aria-hidden="true"/>{ja?'決算リサーチを公開済み':'Earnings research available'}</span>{companies.some(c=>!c.verified)&&<span><i aria-hidden="true"/>{ja?'取得状況を公開':'Intake status'}</span>}</div>
  </div>
  {[{className:styles.desktop,columns:[['MU','NBIS'],['MRVL','LITE','PLTR'],['VRT','MSFT']]},{className:styles.mobile,columns:[['MU','LITE','PLTR'],['NBIS','MRVL','VRT','MSFT']]}].map(layout=><div key={layout.className} className={`${styles.groups} ${layout.className}`}>{layout.columns.map((anchors,index)=><div key={index}>{anchors.map(ticker=>{const entry=[...groups].find(([,members])=>members.some(company=>company.ticker===ticker));if(!entry)return null;const [sector,members]=entry;return <section key={sector}><h2>{sector}<span>{members.length}</span></h2><div className={styles.tiles}>{members.map(company=>{const label=`${company.name}（${company.ticker}）${fresh.has(company.ticker)?(ja?' — 新着あり':' — new items'):''} — ${company.verified?(ja?'決算リサーチを公開済み':'Earnings research available'):(ja?'取得状況を公開':'Intake status')}`;const content=<>
   <strong>{company.ticker}{fresh.has(company.ticker)?<span className={styles.freshTag}>{ja?`新着 ${fresh.get(company.ticker)}`:`New ${fresh.get(company.ticker)}`}<i className={styles.freshDot} aria-hidden="true"/></span>:<i className={company.verified?styles.verified:undefined} aria-hidden="true"/>}</strong><span>{company.name}</span>{showPrices&&<TilePrice ticker={company.ticker} quote={live.quotes[company.ticker]}/>}
  </>;return onOpen
   // An anchor with no address keeps the tile's look (.tiles a) but cannot leave the page.
   ?<a key={company.ticker} role="button" tabIndex={0} aria-label={label} onClick={()=>onOpen(company.ticker)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen(company.ticker);}}}>{content}</a>
   :<Link key={company.ticker} href={companyHref(company.ticker,pro)} aria-label={label}>{content}</Link>;})}</div></section>;})}</div>)}</div>)}
  <details className={base.directoryInfo}><summary>{ja?'掲載状況について':'About coverage'}</summary><p>{ja?'緑の印は数値を照合したリサーチがある銘柄です。速報配信や全資料の分析完了を示すものではありません。':'Green marks indicate source-checked research, not live delivery or complete analysis of every release.'}</p></details>
 </section>;
}
