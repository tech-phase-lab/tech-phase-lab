"use client";
import {Fragment,useEffect,useRef,useState} from 'react';
import ToolShell from '../tool-shell';
import {ReviewLink as Link} from '../review-context';
import {useSavedPlan} from '../features/use-plan';
import {drawWallpaper,wallpaperRules} from '@/lib/resolute/wallpaper';
import {useDesktop,useTouchDevice} from '../use-desktop';
import QrCode from './qr-code';
import pc from '../pc.module.css';
import SectionHeading from '../section-heading';
import styles from '../diagnosis.module.css';
import s from './reference.module.css';
export default function WallScreen({identityReady=true}:{identityReady?:boolean}){return <ToolShell identityReady={identityReady} pc>{locale=><Wall locale={locale}/>}</ToolShell>;}
function Wall({locale}:{locale:'ja'|'en'}){
 const en=locale==='en',{plan,state}=useSavedPlan(),[type,setType]=useState(0),[size,setSize]=useState(0),[background,setBackground]=useState(0),[photo,setPhoto]=useState<HTMLImageElement|null>(null),[error,setError]=useState(false),[ready,setReady]=useState(false);
 const desktop=useDesktop(),touch=useTouchDevice();
 const canvas=useRef<HTMLCanvasElement>(null),phone=useRef<HTMLDivElement>(null),file=useRef<HTMLInputElement>(null),photoGeneration=useRef(0);
 useEffect(()=>()=>{if(photo)URL.revokeObjectURL(photo.src);},[photo]);
 useEffect(()=>{let stale=false;const target=canvas.current;if(!target||!plan||!phone.current)return;void drawWallpaper(target,phone.current,background,photo).then(()=>{if(!stale)setReady(true);},()=>{if(!stale)setError(true);});return()=>{stale=true;};},[plan,type,size,background,locale,photo,desktop]);
 async function upload(f:File|undefined){if(!f)return;const generation=++photoGeneration.current;if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>20*1024*1024){setError(true);return;}const url=URL.createObjectURL(f);try{const image=new Image();image.src=url;await image.decode();if(generation!==photoGeneration.current){URL.revokeObjectURL(url);return;}if(image.naturalWidth*image.naturalHeight>40000000)throw Error();setReady(false);setPhoto(image);setBackground(3);setError(false);}catch{URL.revokeObjectURL(url);setError(true);}}
 function save(){if(!canvas.current||!ready)return;canvas.current.toBlob(blob=>{if(!blob){setError(true);return;}const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='RESOLUTE-rules.png';a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);},'image/png');}
 const rules=plan?wallpaperRules(plan,en):null;
 const groups=[{name:en?'Style':'タイプ',values:en?['Book cover','Simple','Framed','One line']:['本の表紙','シンプル','囲み枠','一言'],value:type,set:setType},{name:en?'Size':'大きさ',values:en?['Large','Medium','Small']:['大','中','小'],value:size,set:setSize},{name:en?'Background':'背景',values:en?['Navy','Black','Beige','Choose photo']:['紺','黒','ベージュ','写真を選択'],value:background,set:setBackground}];
 // The PC branch is drawn only in the browser (useDesktop is false on the server), so the address can be read here.
 const here=desktop?`${window.location.origin}/resolute/wall`:'';
 const choose=(n:number,i:number,g:(typeof groups)[number])=>{if(n===2&&i===3){file.current?.click();return;}if(g.value===i)return;setReady(false);g.set(i);};
 const phonePreview=plan?<div className={s.stage}><div ref={phone} className={`${s.phone} ${s['t'+background]} ${s['ty'+type]} ${s['s'+size]}`} style={background===3&&photo?{backgroundImage:`url(${photo.src})`}:undefined}>
 <div data-preview-only className={s.date}>{en?'Thursday, January 15':'1月15日(木)'}</div><div data-preview-only className={s.clock}>9:41</div><div data-wall-frame data-lines={plan.buyLines.length} className={s.frame}><div className={s.in}><div data-wall-emblem className={s.emb}><b>R</b></div><div className={s.nm}>RESOLUTE</div><div className={s.ed}>THE PERSONAL EDITION</div><div className={s.rl}>
 <div className={s.r}><small>{en?'LOSS LIMIT':'許容できる下落'}</small><span><i>{rules!.tolerance}</i>{plan.tolerancePct!==null?(en?' maximum':' まで'):''}</span></div><div className={s.r}><small>{en?'LIMIT PER STOCK':'1銘柄の上限'}</small><span>{en?'Up to ':'資産の '}<i>{rules!.cap}</i>{en?' of assets':' まで'}</span></div><div className={s.r}><small>{en?'ADD AT':'買い増し'}</small><span style={plan.buyLines.length>4?{fontSize:size===2?9:11}:undefined}>{plan.buyLines.length?plan.buyLines.map((l,i)=><Fragment key={l.dropPct}>{i?(en?' / ':' と '):''}<i>−{l.dropPct}%</i></Fragment>):rules!.lines}</span></div>
 </div><div className={s.ft}>{en?'When in doubt, return to your rules.':'迷ったら、ルールに戻る。'}</div><div className={s.big}><small>{en?'LOSS LIMIT':'許容できる下落'}</small><strong style={rules!.tolerance.length>4?{fontSize:[78,56,42][size]*4/rules!.tolerance.length}:undefined}>{rules!.tolerance}</strong><em>{plan.tolerancePct!==null?(en?'is within my plan.':'までは想定内。'):''}</em><u>{plan.buyMode!=='none'?(en?'Add at ':'買い増し '):''}{rules!.lines}</u></div></div></div></div></div>:null;
 const fileInput=<input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/>;
 const saveButton=<button className={`${styles.primary} ${s.primary}`} disabled={!ready} onClick={save}>{en?'Save this image':'この画像を保存'}</button>;
 const statusLine=<p className={s.status}>{state==='loading'?(en?'Loading your rules…':'ルールを読み込んでいます…'):state==='empty'?<Link href="/resolute/diagnosis">{en?'Save your rules in the quiz first.':'①の診断でルールを保存してください'}</Link>:(en?'Couldn’t load your rules. Please reload.':'ルールを読み込めませんでした。再読み込みしてください')}</p>;
 const fullHint=en?'Set the saved image as your lock screen wallpaper. Photos stay on your device and are never uploaded.':'保存した画像を、ロック画面の壁紙に設定してください。写真は端末の中だけで使い、送信しません。';
 // PC (owner, Nov 25, 01_ルールのお守り_PC): the preview on the left, the settings on the right, the same height. The QR code opens
 // this page on the phone; it is drawn only on a PC (not on a touch screen) and never by an outside service.
 // Phone (resolute-mobile-all-1125 §14): the same two panels one under the other, the shared heading, no QR code.
 const qr=desktop&&!touch&&here;
 const title=en?'Your rules, close at hand':'ルールのお守り',lead=en?'Create a wallpaper for your lock screen.':'ロック画面の壁紙を作ります。';
 return <div className={`${s.root} ${desktop?s.pc:s.phoneLayout}`}><div className={desktop?pc.content:s.wrap}>
  {desktop?<header><p className={pc.eyebrow}><b>RULE CHARM</b>{title}</p><h1 className={pc.title}>{title}</h1><p className={pc.lead}>{lead}</p></header>
   :<SectionHeading label="RULE CHARM" title={title} description={lead}/>}
  {plan?<div className={s.pcPair}>
   <section className={s.pcPreview} aria-label={en?'Preview':'プレビュー'}>{phonePreview}<canvas ref={canvas} hidden/></section>
   <section className={s.pcSettings}>{desktop?<h2>{en?'Wallpaper settings':'壁紙の設定'}</h2>:null}
    {groups.map((g,n)=><div className={s.pcGroup} key={g.name}><b>{g.name}</b><div className={`${s.pcRail} ${n===2?s.pcSwatches:''}`}>{g.values.map((name,i)=><button type="button" key={name} aria-pressed={g.value===i} onClick={()=>choose(n,i,g)}>{n===2?<i className={`${s.swatch} ${i===3?s.swatchPhoto:''}`} style={i<3?{background:['#14233a','#050505','#e6dcc6'][i]}:undefined} aria-hidden="true">{i===3?'+':null}</i>:null}<span>{name}</span></button>)}</div></div>)}{fileInput}
    {qr?<div className={s.qr}><QrCode className={s.qrCode} value={here} label={en?'QR code for this page':'この画面のQRコード'}/><div><b>{en?'Open on your phone':'スマホで開く'}</b><p>{en?<><span>Scan with your phone’s camera to open this page on your phone.</span> <span>Save it there and set it as your lock screen right away.</span></>:<><span>スマホのカメラで読み取ると、この画面がスマホで開きます。</span><span>スマホで保存すると、そのままロック画面に設定できます。</span></>}</p></div></div>:null}
    {desktop?<>{saveButton}<p className={s.hint}>{qr?(en?'Photos stay on your device and are never uploaded.':'写真はこの端末の中だけで使い、送信しません。'):fullHint}</p></>:null}
   </section>
   {desktop?null:<>{saveButton}<p className={s.hint}>{fullHint}</p></>}
  </div>:statusLine}
  {error?<p role="alert">{en?'Couldn’t create the image. Choose a JPEG, PNG or WebP photo under 20 MB.':'画像を作成できませんでした。写真は20MB以内のJPEG・PNG・WebPを選んでください'}</p>:null}
 </div></div>;
}
