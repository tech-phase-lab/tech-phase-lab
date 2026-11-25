import type {CSSProperties} from 'react';
import {formatMove,noStarsLabel,type RiskArticle} from '@/lib/resolute/risk';
/** Shock Gauge (衝撃度チェッカー) shared pieces: one-line heading, and stars with the TP index move (or "waiting"). */
export const SHOCK_GAUGE_NAME={ja:'衝撃度チェッカー',en:'Shock Gauge'} as const;
const faint:CSSProperties={fontFamily:'inherit',fontSize:'.5em',fontWeight:500,letterSpacing:'.2em',opacity:.5,whiteSpace:'nowrap',marginLeft:'auto'};
/** JA: 「衝撃度チェッカー」 left and a small faint 「SHOCK GAUGE」 at the right end of the same line (no extra line). EN: "Shock Gauge". */
export function ShockGaugeTitle({locale}:{locale:'ja'|'en'}){
 return locale==='en'?<>{SHOCK_GAUGE_NAME.en}</>:<span style={{display:'flex',alignItems:'baseline',gap:'0.75em',width:'100%'}}><span>{SHOCK_GAUGE_NAME.ja}</span><small style={faint}>SHOCK GAUGE</small></span>;
}
export const STAR_COLORS=['','#7fb6e0','#e0c070','#f0a24a','#ee7a3c','#ff4d55'];
const small:CSSProperties={fontSize:12,letterSpacing:'.02em',fontWeight:400,color:'var(--sub, #8c98ab)',textShadow:'none',whiteSpace:'nowrap'};
/** Stars and, small next to them, the index and its move (例: TP半導体40 −3.2%). Before the first U.S. close: 「市場の反応待ち」; single-company news: 「個別企業のニュース（★はつけません）」. */
export function ShockStars({article,locale,className,starStyle}:{article:RiskArticle;locale:'ja'|'en';className?:string;starStyle?:CSSProperties}){
 const move=formatMove(article.market,locale);
 if(article.stars===null)return <span className={className} style={{...small,fontSize:13}}>{noStarsLabel(article,locale)}</span>;
 const n=article.stars;
 return <span style={{display:'inline-flex',alignItems:'baseline',gap:10,flexWrap:'wrap'}}><b className={className} style={starStyle} aria-label={`${n}/5`}>{Array.from({length:n},(_,i)=><i key={i} aria-hidden="true" style={{fontStyle:'normal'}}>★</i>)}<span aria-hidden="true">{'☆'.repeat(5-n)}</span></b>{move?<small style={small}>{move}</small>:null}</span>;
}
