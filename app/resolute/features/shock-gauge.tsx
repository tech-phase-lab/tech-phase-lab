import {useState,type CSSProperties} from 'react';
import {formatReading,formatCause,noStarsLabel,starCriteria,starSummary,STAR_INFO_LABEL,type RiskArticle} from '@/lib/resolute/risk';
/** Shock Gauge (衝撃度チェッカー) shared pieces: one-line heading, and stars with the TP index move (or "waiting"). */
export const SHOCK_GAUGE_NAME={ja:'衝撃度チェッカー',en:'Shock Gauge'} as const;
const faint:CSSProperties={fontFamily:'inherit',fontSize:'.5em',fontWeight:500,letterSpacing:'.2em',opacity:.5,whiteSpace:'nowrap',marginLeft:'auto'};
/** JA: 「衝撃度チェッカー」 left and a small faint 「SHOCK GAUGE」 at the right end of the same line (no extra line). EN: "Shock Gauge". */
/** compact (the home card): the name always on one line; the small 「SHOCK GAUGE」 goes on its own line above it when the row is
 * too narrow for both (owner, Nov 25: the name must never wrap on a phone). */
export function ShockGaugeTitle({locale,compact=false}:{locale:'ja'|'en';compact?:boolean}){
 if(locale==='en')return <span style={{whiteSpace:'nowrap'}}>{SHOCK_GAUGE_NAME.en}</span>;
 return <span style={{display:'flex',alignItems:'baseline',gap:compact?'0 0.75em':'0.75em',width:'100%',...(compact?{flexWrap:'wrap-reverse'}:{})}}><span style={{whiteSpace:'nowrap'}}>{SHOCK_GAUGE_NAME.ja}</span><small style={compact?{...faint,marginLeft:0}:faint}>SHOCK GAUGE</small></span>;
}
export const STAR_COLORS=['','#7fb6e0','#e0c070','#f0a24a','#ee7a3c','#ff4d55'];
const small:CSSProperties={fontSize:12,letterSpacing:'.02em',fontWeight:400,color:'var(--sub, #8c98ab)',textShadow:'none',whiteSpace:'nowrap'};
/** Stars and, small next to them, both indices measured on the story's first close and the fear index (例: TP半導体40 −8.5%（いつもの3.8倍・40社中39社が下落）). Before the first U.S. close: 「市場の反応待ち」; single-company news: 「個別企業のニュース（★はつけません）」. */
export function ShockStars({article,locale,className,starStyle}:{article:RiskArticle;locale:'ja'|'en';className?:string;starStyle?:CSSProperties}){
 const why=formatCause(article,locale),lines=[...formatReading(article.market,locale),...(why?[why]:[])];
 if(article.stars===null)return <span className={className} style={{...small,fontSize:13}}>{noStarsLabel(article,locale)}</span>;
 const n=article.stars;
 return <span style={{display:'inline-flex',alignItems:'baseline',gap:10,flexWrap:'wrap'}}><b className={className} style={starStyle} aria-label={`${n}/5`}>{Array.from({length:n},(_,i)=><i key={i} aria-hidden="true" style={{fontStyle:'normal'}}>★</i>)}<span aria-hidden="true">{'☆'.repeat(5-n)}</span></b>{lines.length?<small style={{...small,whiteSpace:'normal',display:'flex',flexDirection:'column',gap:2}}>{lines.map(l=><span key={l}>{l}</span>)}</small>:null}</span>;
}
/** One small 「i」 next to the ★ label (owner, Nov 25: no extra visible text). Tapping it opens how the stars are set:
 * the short explanation and the exact levels, both generated from the published rule. The panel spans the nearest positioned
 * row (the news screen's star row), so it never widens a phone screen. */
export function StarInfo({locale}:{locale:'ja'|'en'}){
 const [open,setOpen]=useState(false);
 return <span style={{display:'inline-block',marginLeft:6,verticalAlign:'middle'}}>
  <button type="button" aria-label={STAR_INFO_LABEL[locale]} aria-expanded={open} onClick={()=>setOpen(v=>!v)}
   style={{width:18,height:18,borderRadius:'50%',border:'1px solid currentColor',background:'transparent',color:'inherit',opacity:.6,font:'600 11px/16px inherit',padding:0,cursor:'pointer'}}>i</button>
  {open?<span role="note" style={{position:'absolute',left:0,right:0,top:'calc(100% + 6px)',zIndex:5,boxSizing:'border-box',padding:'10px 12px',borderRadius:10,background:'var(--card, #10151d)',border:'1px solid var(--line, #2a3340)',color:'var(--text, #e8edf3)',fontSize:12,lineHeight:1.6,fontWeight:400,letterSpacing:0,whiteSpace:'pre-line',textAlign:'left',boxShadow:'0 8px 24px rgba(0,0,0,.35)'}}>{starSummary(locale)+'\n\n'+starCriteria(locale)}</span>:null}
 </span>;
}
