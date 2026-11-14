"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {chainFocus} from '@/lib/research/chain-network';
import {layoutCompanyNetwork,networkLayers,networkEdgePath} from '@/lib/research/company-network';
import type {CompanyNetwork,NetworkEdge,NetworkMode} from '@/lib/research/company-network';
import {GatedChainMap} from './gated-chain-map';
import styles from './company-network.module.css';
type Props={graph:CompanyNetwork;lang:'ja'|'en'};
export function CompanyNetworkMap(props:Props){
 // The profile only says that a map exists; the map itself comes from the PRO-gated API (NVDA is the free sample).
 if(props.graph.chained)return <GatedChainMap root={props.graph.root} lang={props.lang}/>;
 return <ChainCompanyNetworkMap {...props}/>;
}
export function ChainCompanyNetworkMap({graph,lang}:Props){
 const ja=lang==='ja',t=(a:string,b:string)=>ja?a:b;
 const [mode,setMode]=useState<NetworkMode>('direct'),[width,setWidth]=useState(640);
 const board=useRef<HTMLDivElement>(null);
 const focus=useMemo(()=>chainFocus(graph,mode),[graph,mode]);
 const directFocus=useMemo(()=>chainFocus(graph,'direct'),[graph]);
 const hasExpansion=focus.nodes.some(n=>!directFocus.nodes.some(d=>d.id===n.id))||focus.edges.some(e=>!directFocus.edges.some(d=>d.id===e.id));
 const modeLabel=mode==='direct'?t('直接の関係','Direct relationships'):mode==='two'?t('2段先まで','Up to two steps away'):t('全体','Everything');
 const hasCompetition=focus.edges.some(e=>e.kind==='competition');
 const byId=new Map(graph.nodes.map(n=>[n.id,n]));
 const root=byId.get(graph.root)!;
 const tone=(e:NetworkEdge)=>e.kind==='competition'?'competition':e.from!==graph.root&&e.to!==graph.root?'indirect':e.kind==='supply'?e.to===graph.root?'upstream':'downstream':'partner';
 const primary=(edges:NetworkEdge[])=>edges.find(e=>e.kind==='supply'&&e.to===graph.root)??edges.find(e=>e.kind==='supply'&&e.from===graph.root)??edges.find(e=>e.kind==='competition')??edges.find(e=>e.from===graph.root||e.to===graph.root)??edges[0];
 const tag=(e:NetworkEdge)=>({competition:t('競合','Competitor'),upstream:t('供給','Supplier'),downstream:t('納入','Customer'),indirect:t('間接','Indirect'),partner:e.evidence.some(v=>v.label.ja.includes('出資'))?t('出資','Investment'):t('提携','Partner')}[tone(e)]);
 const {positions,height,layers}=layoutCompanyNetwork(focus.nodes,width);
 const edgePath=(edge:NetworkEdge,index:number)=>{const peers=focus.edges.filter(e=>(e.from===edge.from&&e.to===edge.to)||(e.from===edge.to&&e.to===edge.from));const shift=(peers.indexOf(edge)-(peers.length-1)/2)*5;return networkEdgePath({...positions[edge.from],x:positions[edge.from].x+shift},{...positions[edge.to],x:positions[edge.to].x+shift},index%4*2)};
 const groups=new Map<string,NetworkEdge[]>();
 for(const n of focus.nodes){if(n.id===graph.root)continue;const edges=focus.edges.filter(e=>e.from===n.id||e.to===n.id);if(edges.length)groups.set(n.id,edges);}
 const sections=[['upstream',t('供給元（上流）','Suppliers (upstream)')],['downstream',t('納入先・顧客（下流）','Customers (downstream)')],['partner',t('提携・出資','Partnerships & investment')],['indirect',t('さらに先の関係','Related connections')],['competition',t('競合','Competitors')]] as const;
 useEffect(()=>{if(!board.current)return;const el=board.current;const measure=()=>setWidth(Math.floor(el.getBoundingClientRect().width));measure();const ro=new ResizeObserver(measure);ro.observe(el);return()=>ro.disconnect()},[graph.edges.length]);
 return <section className={`${styles.network} ${styles.quotedMap}`} aria-label={t('企業の連鎖マップ','Company relationships')} data-mode={mode}>
  <div className={styles.toolbar}><div className={styles.titleRow}><h3>{t('企業の連鎖マップ','Company relationships')}</h3><div className={styles.modes} role="group" aria-label={t('表示範囲','Range')}>
   <button type="button" aria-pressed={mode==='direct'} onClick={()=>setMode('direct')}>{t('直接の関係','Direct')}</button>
   <button type="button" aria-pressed={mode==='two'} onClick={()=>setMode('two')}>{t('2段先まで','Two steps')}</button>
  </div></div><div className={styles.selection}><div className={styles.selectedName}><strong>{root.ticker??root.name}</strong><span>{root.name}</span></div><span className={styles.count}>{ja?`${focus.nodes.length-1}社との関係`:`${focus.nodes.length-1} related ${focus.nodes.length-1===1?'company':'companies'}`}</span></div></div>
  <p className={styles.hint} role="status">{ja?`${modeLabel}を表示中`:`Showing: ${modeLabel}`}{mode!=='direct'&&!hasExpansion?t('。この銘柄は、2段先の関係がまだありません','. No two-step relationships for this stock yet'):''}</p>
  {graph.edges.length===0?<p className={styles.hint}>{graph.status==='no_verified_relations'?t('公式の情報から確認できる関係は、現時点ではありません','No relationships can be confirmed from official sources yet'):t('この銘柄の連鎖マップは準備中です','The relationship map for this stock is being prepared')}</p>:<>
   <div className={styles.legend}>{[['upstream',t('供給・採用元','Suppliers / sources')],['downstream',t('納入・採用先','Customers / adopters')],['partner',t('提携・出資・技術対応','Partnerships, investment & technology support')],['indirect',t('さらに先の関係','Related connections')],...(hasCompetition?[['competition',t('競合','Competitors')]]:[])].map(([color,label])=><span key={color} data-tone={color}>{label}</span>)}</div>
   {hasCompetition&&<div className={styles.competitors}><h3>{t('競合は？','Who competes with it?')}</h3><div>{[...focus.competitors].map(id=><span className={styles.competitor} key={id}>{byId.get(id)?.ticker??byId.get(id)?.name}</span>)}</div></div>}
   <h3 className={styles.mapHeading}>{t('どこと繋がる？','Who does it work with?')}</h3>
   <div className={styles.board} ref={board} style={{height}}>
    {layers.map(layer=><div key={layer.index} className={styles.layer} data-layer={layer.index} style={{top:layer.y}}>{networkLayers[layer.index][lang]}</div>)}
    <svg className={styles.lines} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">{focus.edges.map((e,index)=>{const d=edgePath(e,index),coords=d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);return <g key={e.id} data-tone={tone(e)}><path d={d} data-tone={tone(e)} data-direct={e.from===graph.root||e.to===graph.root} data-from={e.from} data-to={e.to}/><circle cx={coords[0]} cy={coords[1]} r={3} /><circle cx={coords.at(-2)} cy={coords.at(-1)} r={3}/></g>})}</svg>
    {focus.nodes.map(n=>{const p=positions[n.id],edges=focus.edges.filter(e=>e.from===n.id||e.to===n.id),own=primary(edges);return <div key={n.id} className={styles.node} data-company={n.id} data-symbol={Boolean(n.ticker)} data-competitor={n.id!==graph.root&&edges.some(e=>e.kind==='competition')} aria-current={n.id===graph.root} data-tone={n.id===graph.root?'selected':own?tone(own):'indirect'} style={{left:p.x,top:p.y,width:p.width,height:p.height}} aria-label={n.name}>
     <strong>{n.ticker??n.name}</strong>{n.ticker&&<span className={styles.companyName}>{n.name}</span>}
    </div>})}
   </div>
   <div className={styles.inspector}><h3>{ja?<>{root.ticker??root.name}{mode==='direct'?'との関係':'を起点とした関係'}</>:<>{mode==='direct'?'Relationships with ':'Relationships starting from '}{root.ticker??root.name}</>}</h3>{sections.map(([color,label])=>{const members=[...groups].filter(([,edges])=>tone(primary(edges))===color);return members.length>0&&<section className={styles.relationshipGroup} data-relationship-group={color} data-tone={color} key={color}><h4>{label} <span>{ja?`${members.length}社`:members.length}</span></h4><ul>{members.map(([id,edges])=><li key={id} data-company-detail={id} data-tone={tone(primary(edges))}>
    <div className={styles.connectionTitle}><strong>{byId.get(id)?.ticker??byId.get(id)?.name}</strong><div className={styles.tags}>{[...new Map(edges.map(e=>[tag(e),tone(e)])).entries()].map(([label,color])=><span key={label} data-tone={color}>{label}</span>)}</div></div>
    <p className={styles.relationshipText}>{primary(edges).evidence[0].label[lang]||primary(edges).evidence[0].label.ja}</p><details className={styles.evidence}><summary>{t('出典・引用・発表日','Sources, quotes & dates')}</summary>{edges.map(e=><div key={e.id}>{e.evidence.map((v,i)=><div key={i}><p className={styles.relationshipText}>{v.label[lang]||v.label.ja}</p><time dateTime={v.reviewedOn}>{v.reviewedOn}</time><blockquote>{v.evidence_quote}</blockquote>{v.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{t('公式資料を開く ↗','Open official source ↗')}</a>)}</div>)}</div>)}</details>
   </li>)}</ul></section>})}</div>
   <div className={styles.allControl}><button type="button" onClick={()=>setMode(mode==='all'?'direct':'all')}>{mode==='all'?t('直接の関係に戻る','Back to direct relationships'):t('全体を見る','See everything')}</button></div>
  </>}
  <p className={styles.footnote}>{t('公式資料の引用で確認できた関係のみ表示しています。2段先は直接取引を意味しません。','Only relationships confirmed by quotes from official sources are shown. Two steps away does not mean a direct business relationship.')}</p>
 </section>;
}
