"use client";

import Link from 'next/link';
import styles from './compact-quote.module.css';

export default function CompactQuote({ticker,quoteTicker=ticker,exchange,lang}:{ticker:string;quoteTicker?:string;exchange:string;lang:'ja'|'en'}) {
 // KRX prices are not offered in the embedded widget; retain the provider link.
 if(exchange==='KRX')return <section className={styles.quote} aria-label={lang==='ja'?'株価':'Stock price'}><div className={styles.links}><span>{lang==='ja'?'株価は提供元で確認':'Price on provider site'}</span><a href={`https://www.tradingview.com/symbols/${exchange}-${quoteTicker}/`} target="_blank" rel="noreferrer">TradingView ↗</a></div></section>;
 const symbol=`${exchange}:${quoteTicker}`;
 const src=`/research/stocks/widget?${new URLSearchParams({symbol,kind:'quote',lang})}`;
 return <section className={styles.quote} aria-label={lang==='ja'?'株価':'Stock price'}>
  <iframe key={src} src={src} title={`${ticker} TradingView ${lang==='ja'?'株価':'quote'}`} />
  <div className={styles.links}>
   <a href={`https://www.tradingview.com/symbols/${exchange}-${quoteTicker}/`} target="_blank" rel="noreferrer">TradingView ↗</a>
   <span>{lang==='ja'?'遅延データ':'Delayed data'}</span>
   <Link href={`/research/stocks?q=${encodeURIComponent(ticker)}`}>{lang==='ja'?'チャート':'Chart'} →</Link>
  </div>
 </section>;
}
