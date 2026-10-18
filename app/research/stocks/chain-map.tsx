"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {chainFocus} from '@/lib/research/chain-network';
import {networkEdgePath} from '@/lib/research/company-network';
import type {CompanyNetwork,NetworkEdge,NetworkMode} from '@/lib/research/company-network';
import styles from './company-network.module.css';
type Props={graph:CompanyNetwork;lang:'ja'|'en'};
export function CompanyNetworkMap({graph}:Props){
 const [mode,setMode]=useState<NetworkMode>('direct'),[width,setWidth]=useState(640);
 const board=useRef<HTMLDivElement>(null);
 const focus=useMemo(()=>chainFocus(graph,mode),[graph,mode]);
 const directFocus=useMemo(()=>chainFocus(graph,'direct'),[graph]);
 const hasExpansion=focus.nodes.some(n=>!directFocus.nodes.some(d=>d.id===n.id))||focus.edges.some(e=>!directFocus.edges.some(d=>d.id===e.id));
 const modeLabel=mode==='direct'?'直接の関係':mode==='two'?'2段先まで':'全体';
 const hasCompetition=focus.edges.some(e=>e.kind==='competition');
 const byId=new Map(graph.nodes.map(n=>[n.id,n]));
 const root=byId.get(graph.root)!;
 const tone=(e:NetworkEdge)=>e.kind==='competition'?'competition':e.kind==='supply'?e.to===graph.root?'upstream':e.from===graph.root?'downstream':'indirect':'partner';
 const tag=(e:NetworkEdge)=>({competition:'競合',upstream:'供給・採用元',downstream:'納入・採用先',indirect:'さらに先の関係',partner:'提携・出資・技術対応'}[tone(e)]);
 const columns=width<500?2:Math.min(5,Math.max(2,Math.floor(width/180))),gap=12,pad=12;
 const cardWidth=(width-pad*2-gap*(columns-1))/columns,cardHeight=154;
 const positions=Object.fromEntries(focus.nodes.map((n,i)=>[n.id,{x:pad+(i%columns)*(cardWidth+gap),y:pad+Math.floor(i/columns)*(cardHeight+32),width:cardWidth,height:cardHeight}]));
 const height=24+Math.ceil(focus.nodes.length/columns)*(cardHeight+32);
 const groups=new Map<string,NetworkEdge[]>();
 for(const n of focus.nodes){if(n.id===graph.root)continue;const edges=focus.edges.filter(e=>e.from===n.id||e.to===n.id);if(edges.length)groups.set(n.id,edges);}
 useEffect(()=>{if(!board.current)return;const el=board.current;const measure=()=>setWidth(Math.floor(el.getBoundingClientRect().width));measure();const ro=new ResizeObserver(measure);ro.observe(el);return()=>ro.disconnect()},[graph.edges.length]);
 return <section className={`${styles.network} ${styles.quotedMap}`} aria-label="企業の連鎖マップ" data-mode={mode}>
  <div className={styles.toolbar}><div className={styles.titleRow}><h3>企業の連鎖マップ</h3><div className={styles.modes} role="group" aria-label="表示範囲">
   <button type="button" aria-pressed={mode==='direct'} onClick={()=>setMode('direct')}>直接の関係</button>
   <button type="button" aria-pressed={mode==='two'} onClick={()=>setMode('two')}>2段先まで</button>
  </div></div><div className={styles.selection}><div className={styles.selectedName}><strong>{root.ticker??root.name}</strong><span>{root.name}</span></div><span className={styles.count}>{focus.nodes.length-1}社との関係</span></div></div>
  <p className={styles.hint} role="status">{modeLabel}を表示中{mode!=='direct'&&!hasExpansion?'。この銘柄は、2段先の関係がまだありません':''}</p>
  {graph.edges.length===0?<p className={styles.hint}>{graph.status==='no_verified_relations'?'公式の情報から確認できる関係は、現時点ではありません':'この銘柄の連鎖マップは準備中です'}</p>:<>
   <div className={styles.legend}>{[['upstream','供給・採用元'],['downstream','納入・採用先'],['partner','提携・出資・技術対応'],['indirect','さらに先の関係'],...(hasCompetition?[['competition','競合']]:[])].map(([color,label])=><span key={color} data-tone={color}>{label}</span>)}</div>
   <div className={styles.board} ref={board} style={{height}}>
    <svg className={styles.lines} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">{focus.edges.map(e=><path key={e.id} d={networkEdgePath(positions[e.from],positions[e.to])} data-tone={tone(e)} data-from={e.from} data-to={e.to}/>)}</svg>
    {focus.nodes.map(n=>{const p=positions[n.id],edges=focus.edges.filter(e=>e.from===n.id||e.to===n.id),own=edges.find(e=>e.from===graph.root||e.to===graph.root)??edges[0];return <div key={n.id} className={styles.node} data-company={n.id} data-tone={n.id===graph.root?'selected':own?tone(own):'indirect'} style={{left:p.x,top:p.y,width:p.width,height:p.height}} aria-label={n.name}>
     {n.ticker&&<strong>{n.ticker}</strong>}<span className={styles.companyName}>{n.name}</span><span>{n.id===graph.root?'起点の企業':own?.evidence[0].label.ja}</span>
    </div>})}
   </div>
   <div className={styles.inspector}><h3>{root.ticker??root.name}{mode==='direct'?'との関係':'を起点とした関係'}</h3><ul>{[...groups].map(([id,edges])=><li key={id} data-company-detail={id}>
    <div className={styles.connectionTitle}><strong>{byId.get(id)?.name}</strong></div><div className={styles.tags}>{[...new Set(edges.map(tag))].map(t=><span key={t}>{t}</span>)}</div>
    {edges.map(e=><div key={e.id}>{mode!=='direct'&&<p className={styles.relationshipText}>{byId.get(e.from)?.name} → {byId.get(e.to)?.name}</p>}<p className={styles.relationshipText}>{e.evidence[0].label.ja}</p><details className={styles.evidence}><summary>出典・引用・発表日</summary>{e.evidence.map((v,i)=><div key={i}><time dateTime={v.reviewedOn}>{v.reviewedOn}</time><blockquote>{v.evidence_quote}</blockquote>{v.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">公式資料を開く ↗</a>)}</div>)}</details></div>)}
   </li>)}</ul></div>
   <div className={styles.allControl}><button type="button" onClick={()=>setMode(mode==='all'?'direct':'all')}>{mode==='all'?'直接の関係に戻る':'全体を見る'}</button></div>
  </>}
  <p className={styles.footnote}>公式資料の引用で確認できた関係のみ表示しています。2段先は直接取引を意味しません。</p>
 </section>;
}
