import {useState,type CSSProperties} from 'react';
import {readingParts,formatCause,noStarsLabel,starCriteria,starSummary,STAR_INFO_LABEL,type RiskArticle} from '@/lib/resolute/risk';
/** Shock Gauge (衝撃度チェッカー) shared pieces: one-line heading, and stars with the TP index move (or "waiting"). */
export const SHOCK_GAUGE_NAME={ja:'衝撃度チェッカー',en:'Shock Gauge'} as const;
const faint:CSSProperties={fontFamily:'inherit',fontSize:'.5em',fontWeight:500,letterSpacing:'.2em',opacity:.5,whiteSpace:'nowrap',marginLeft:'auto'};
/** JA: 「衝撃度チェッカー」 left and a small faint 「SHOCK GAUGE」 at the right end of the same line (no extra line). EN: "Shock Gauge". */
/** compact (the home card): the name always on one line; the small 「SHOCK GAUGE」 goes on its own line above it when the row is
 * too narrow for both (owner, Nov 25: the name must never wrap on a phone). */
export function ShockGaugeTitle({locale,compact=false,center=false}:{locale:'ja'|'en';compact?:boolean;center?:boolean}){
 if(locale==='en')return <span style={{whiteSpace:'nowrap'}}>{SHOCK_GAUGE_NAME.en}</span>;
 return <span style={{display:'flex',alignItems:'baseline',gap:compact?'0 0.75em':'0.75em',width:'100%',...(compact?{flexWrap:'wrap-reverse'}:{}),...(center?{justifyContent:'center'}:{})}}><span style={{whiteSpace:'nowrap'}}>{SHOCK_GAUGE_NAME.ja}</span><small style={compact?{...faint,marginLeft:0}:faint}>SHOCK GAUGE</small></span>;
}
export const STAR_COLORS=['','#7fb6e0','#e0c070','#f0a24a','#ee7a3c','#ff4d55'];
const small:CSSProperties={fontSize:12,letterSpacing:'.02em',fontWeight:400,color:'var(--sub, #8c98ab)',textShadow:'none',whiteSpace:'nowrap'};
/** Each index line stays on one phone line (owner, Nov 25): the move and its parenthetical never break inside, and the
 * parenthetical is set a little smaller. Only on a screen too narrow for both does the parenthetical move down whole. */
const nowrap:CSSProperties={whiteSpace:'nowrap',letterSpacing:0};
// Owner, Nov 26: the parenthetical always sits on the next line, in smaller type.
const detail:CSSProperties={whiteSpace:'nowrap',fontSize:'.8em',letterSpacing:0,fontFeatureSettings:'"palt"',display:'block'};
/** Stars and, small next to them, both indices measured on the story's session and, on a down move, the fear index (例: TP半導体40 −8.5%（いつもの3.8倍・39/40社が下落）); single-company news with stars first shows its own move (例: SKHY −8.2%（いつもの3.1倍）). Before the session's close: 「市場の反応待ち」; single-company news without stars: 「個別企業のニュース（★はつけません）」. */
/** wide: the stars join the parent's wrapping flex row (the news screen's 「衝撃度」 row) and the lines take that row's full
 * width underneath, instead of the narrower column beside its label. */
export function ShockStars({article,locale,className,starStyle,wide=false}:{article:RiskArticle;locale:'ja'|'en';className?:string;starStyle?:CSSProperties;wide?:boolean}){
 const why=formatCause(article,locale),lines=[...readingParts(article.market,locale),...(why?[{text:why}]:[])];
 if(article.stars===null)return <span className={className} style={{...small,fontSize:13}}>{noStarsLabel(article,locale)}</span>;
 const n=article.stars;
 return <span style={wide?{display:'contents'}:{display:'inline-flex',alignItems:'baseline',gap:10,flexWrap:'wrap'}}><b className={className} style={starStyle} aria-label={`${n}/5`}>{Array.from({length:n},(_,i)=><i key={i} aria-hidden="true" style={{fontStyle:'normal'}}>★</i>)}<span aria-hidden="true">{'☆'.repeat(5-n)}</span></b>{lines.length?<small style={{...small,whiteSpace:'normal',display:'flex',flexDirection:'column',gap:2,...(wide?{flexBasis:'100%'}:{})}}>{lines.map(l=><span key={l.text}>{l.detail?<><span style={nowrap}>{l.text}</span><span style={detail}>{l.detail}</span></>:l.text}</span>)}</small>:null}</span>;
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
