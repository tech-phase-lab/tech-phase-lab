"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {chainFocus} from '@/lib/research/chain-network';
import {layoutCompanyNetwork,networkLayers,networkEdgePath} from '@/lib/research/company-network';
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
 const primary=(edges:NetworkEdge[])=>edges.find(e=>e.kind==='supply'&&e.to===graph.root)??edges.find(e=>e.kind==='supply'&&e.from===graph.root)??edges.find(e=>e.kind==='competition')??edges.find(e=>e.from===graph.root||e.to===graph.root)??edges[0];
 const tag=(e:NetworkEdge)=>({competition:'競合',upstream:'供給',downstream:'納入',indirect:'間接',partner:e.evidence.some(v=>v.label.ja.includes('出資'))?'出資':'提携'}[tone(e)]);
 const {positions,height,layers}=layoutCompanyNetwork(focus.nodes,width);
 const edgePath=(edge:NetworkEdge,index:number)=>{const peers=focus.edges.filter(e=>(e.from===edge.from&&e.to===edge.to)||(e.from===edge.to&&e.to===edge.from));const shift=(peers.indexOf(edge)-(peers.length-1)/2)*5;return networkEdgePath({...positions[edge.from],x:positions[edge.from].x+shift},{...positions[edge.to],x:positions[edge.to].x+shift},index%4*2)};
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
    {layers.map(layer=><div key={layer.index} className={styles.layer} data-layer={layer.index} style={{top:layer.y}}>{networkLayers[layer.index].ja}</div>)}
    <svg className={styles.lines} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">{focus.edges.map((e,index)=><path key={e.id} d={edgePath(e,index)} data-tone={tone(e)} data-direct={e.from===graph.root||e.to===graph.root} data-from={e.from} data-to={e.to}/>)}</svg>
    {focus.nodes.map(n=>{const p=positions[n.id],edges=focus.edges.filter(e=>e.from===n.id||e.to===n.id),own=primary(edges);return <div key={n.id} className={styles.node} data-company={n.id} data-symbol={Boolean(n.ticker)} data-competitor={edges.some(e=>e.kind==='competition')} aria-current={n.id===graph.root} data-tone={n.id===graph.root?'selected':own?tone(own):'indirect'} style={{left:p.x,top:p.y,width:p.width,height:p.height}} aria-label={n.name}>
     <strong>{n.ticker??n.name}</strong>{n.ticker&&<span className={styles.companyName}>{n.name}</span>}
    </div>})}
   </div>
   <div className={styles.inspector}><h3>{root.ticker??root.name}{mode==='direct'?'との関係':'を起点とした関係'}</h3><ul>{[...groups].map(([id,edges])=><li key={id} data-company-detail={id} data-tone={tone(primary(edges))}>
    <div className={styles.connectionTitle}><strong>{byId.get(id)?.ticker??byId.get(id)?.name}</strong><div className={styles.tags}>{[...new Map(edges.map(e=>[tag(e),tone(e)])).entries()].map(([label,color])=><span key={label} data-tone={color}>{label}</span>)}</div></div>
    <p className={styles.relationshipText}>{primary(edges).evidence[0].label.ja}</p><details className={styles.evidence}><summary>出典・引用・発表日</summary>{edges.map(e=><div key={e.id}>{e.evidence.map((v,i)=><div key={i}><p className={styles.relationshipText}>{v.label.ja}</p><time dateTime={v.reviewedOn}>{v.reviewedOn}</time><blockquote>{v.evidence_quote}</blockquote>{v.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">公式資料を開く ↗</a>)}</div>)}</div>)}</details>
   </li>)}</ul></div>
   <div className={styles.allControl}><button type="button" onClick={()=>setMode(mode==='all'?'direct':'all')}>{mode==='all'?'直接の関係に戻る':'全体を見る'}</button></div>
  </>}
  <p className={styles.footnote}>公式資料の引用で確認できた関係のみ表示しています。2段先は直接取引を意味しません。</p>
 </section>;
}
